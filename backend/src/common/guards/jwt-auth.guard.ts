import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators';
import type { AccessContext } from '../types/access-context';

/**
 * Xác thực JWT cho mọi endpoint, trừ những endpoint gắn @Public().
 * Nếu endpoint gắn @Public() nhưng có gửi kèm token thì vẫn giải mã để phục vụ phân quyền tuỳ chọn.
 * Phiên đăng nhập được kiểm tra tồn tại trong Redis (thu hồi được tức thì).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      const req = context.switchToHttp().getRequest();
      const authHeader = req?.headers?.authorization;
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return super.canActivate(context);
      }
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = AccessContext>(
    err: Error | null,
    user: TUser | false,
    info: Error | undefined,
    context?: ExecutionContext,
  ): TUser {
    if (context) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) {
        return (user || undefined) as unknown as TUser;
      }
    }
    if (err) throw err;
    if (!user) {
      const reason = info?.message === 'jwt expired' ? 'Phiên đăng nhập đã hết hạn' : 'Chưa đăng nhập';
      throw new UnauthorizedException(reason);
    }
    return user;
  }
}
