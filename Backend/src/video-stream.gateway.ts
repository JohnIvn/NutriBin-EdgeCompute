import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type VideoFramePayload = { id: string; frame: string };

function isVideoFramePayload(obj: unknown): obj is VideoFramePayload {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.frame === 'string';
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class VideoStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private producers = new Set<string>();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
    client.emit('stream-status', { active: this.producers.size > 0 });
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    if (this.producers.has(client.id)) {
      this.producers.delete(client.id);
      if (this.producers.size === 0) {
        this.server.emit('stream-status', { active: false });
      }
    }
  }

  @SubscribeMessage('video-frame')
  async handleVideoFrame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    console.log('VideoStreamGateway handler invoked - DEBUG');
    if (!client || !client.id) {
      console.error('handleVideoFrame: client missing or invalid', client);
      return;
    }
    if (!this.producers.has(client.id)) {
      this.producers.add(client.id);
      this.server.emit('stream-status', { active: true });
    }
    if (!isVideoFramePayload(data)) {
      console.error('Received invalid payload:', data);
      return;
    }
    const payload: VideoFramePayload = { id: data.id, frame: data.frame };

    // Run local classifier on the frame (base64 image)
    const scriptPath = path.join(__dirname, 'run_trash_classifier.py');
    const python = process.env.PYTHON_PATH || 'python';
    execFile(
      python,
      [scriptPath, payload.frame],
      { maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        let detection: string | null = null;
        if (err) {
          console.error('Classifier error:', err, stderr);
        } else {
          detection = stdout.trim();
        }
        // Ensure static directory exists before writing
        const staticDir = path.join(__dirname, 'static');
        if (!fs.existsSync(staticDir)) {
          fs.mkdirSync(staticDir, { recursive: true });
        }
        const staticPath = path.join(staticDir, 'detection.json');
        let detections: Array<{
          id: string;
          detection: string | null;
          timestamp: number;
        }> = [];
        try {
          if (fs.existsSync(staticPath)) {
            detections = JSON.parse(fs.readFileSync(staticPath, 'utf-8'));
          }
        } catch (e) {
          detections = [];
        }
        detections.push({ id: payload.id, detection, timestamp: Date.now() });
        fs.writeFileSync(staticPath, JSON.stringify(detections, null, 2));
        // Optionally emit detection to clients
        this.server.emit('detection', { id: payload.id, detection });
      },
    );
    // Still emit the frame as before
    this.server.emit('stream', payload);
  }
}
