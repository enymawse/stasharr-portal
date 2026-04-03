import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV === 'production') {
    const staticAssetsPath = join(
      process.cwd(),
      'apps/sp-web/dist/sp-web/browser',
    );
    const indexFilePath = join(staticAssetsPath, 'index.html');

    if (existsSync(indexFilePath)) {
      app.useStaticAssets(staticAssetsPath, { index: false });
      app
        .getHttpAdapter()
        .getInstance()
        .get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response) => {
          if (extname(req.path)) {
            res.status(404).end();
            return;
          }

          res.sendFile(indexFilePath);
        });
    } else {
      logger.warn(`Static frontend build not found at ${staticAssetsPath}`);
    }
  }

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);
}
void bootstrap();
