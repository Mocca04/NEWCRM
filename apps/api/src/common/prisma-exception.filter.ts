import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@newcrm/database';
import type { Response } from 'express';

/** Traduce errores conocidos de la base a respuestas HTTP coherentes. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, message] =
      error.code === 'P2002'
        ? [HttpStatus.CONFLICT, 'Ya existe un registro con esos datos']
        : error.code === 'P2025'
          ? [HttpStatus.NOT_FOUND, 'No encontrado']
          : [HttpStatus.INTERNAL_SERVER_ERROR, 'Error interno'];
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) console.error(error);
    response.status(status).json({ statusCode: status, message });
  }
}
