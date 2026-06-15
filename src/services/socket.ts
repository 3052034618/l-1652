import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer } from 'http';
import { config } from '../config';
import { verifyToken, JwtPayload } from '../utils/auth';

let io: SocketIOServer | null = null;

interface CustomSocket extends Socket {
  user?: JwtPayload;
}

export function initSocketServer(httpServer?: ReturnType<typeof createServer>) {
  if (io) return io;

  if (httpServer) {
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
  } else {
    io = new SocketIOServer(config.socketPort, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
    console.log(`WebSocket server running on port ${config.socketPort}`);
  }

  io.use((socket: CustomSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('认证失败'));
      }
      socket.user = verifyToken(token as string);
      next();
    } catch (error) {
      next(new Error('无效的令牌'));
    }
  });

  io.on('connection', (socket: CustomSocket) => {
    console.log(`Client connected: ${socket.user?.userId} (${socket.user?.role})`);
    
    if (socket.user?.userId) {
      socket.join(`user:${socket.user.userId}`);
      socket.join(`role:${socket.user.role}`);
    }

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.user?.userId}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

export function emitToUser(userId: string, event: string, data: any) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
  console.log(`Emitted ${event} to user ${userId}`);
}

export function emitToRole(role: string, event: string, data: any) {
  if (!io) return;
  io.to(`role:${role}`).emit(event, data);
  console.log(`Emitted ${event} to role ${role}`);
}

export function emitToAll(event: string, data: any) {
  if (!io) return;
  io.emit(event, data);
  console.log(`Emitted ${event} to all`);
}

export function broadcastOrderUpdate(order: any) {
  if (order.student_id) {
    emitToUser(order.student_id, 'order:updated', order);
  }
  emitToRole('chef', 'order:updated', order);
  emitToRole('admin', 'order:updated', order);
}

export function broadcastTaskUpdate(task: any) {
  if (task.chef_id) {
    emitToUser(task.chef_id, 'task:updated', task);
  }
  emitToRole('admin', 'task:updated', task);
}

export function broadcastInventoryUpdate(inventory: any) {
  emitToRole('admin', 'inventory:updated', inventory);
  emitToRole('supplier', 'inventory:updated', inventory);
}

export function broadcastPurchaseUpdate(purchase: any) {
  emitToRole('admin', 'purchase:updated', purchase);
  if (purchase.supplier_id) {
    emitToUser(purchase.supplier_id, 'purchase:updated', purchase);
  }
}
