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
  handleVideoFrame(
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

    // Broadcast a well-typed payload to all connected clients
    const payload: VideoFramePayload = { id: data.id, frame: data.frame };
    this.server.emit('stream', payload);
  }
}
