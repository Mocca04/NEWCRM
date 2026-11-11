import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config';
import { setupApp } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  setupApp(app);
  app.enableCors({ origin: config.corsOrigins, allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant-Id', 'Idempotency-Key'] });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('NEWCRM API').setDescription('API de la plataforma. Las rutas de empresa requieren la cabecera X-Tenant-Id.').setVersion('0.2.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.port);
  console.log(`API en http://localhost:${config.port}/api/v1 · documentacion en /api/docs`);
}

void bootstrap();
