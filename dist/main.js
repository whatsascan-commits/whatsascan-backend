"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    try {
        const app = await core_1.NestFactory.create(app_module_1.AppModule, {
            cors: {
                origin: true,
                credentials: true,
            },
        });
        app.enableShutdownHooks();
        app.useWebSocketAdapter(new platform_socket_io_1.IoAdapter(app));
        app.setGlobalPrefix('api');
        const http = app.getHttpAdapter().getInstance();
        http.get('/api/health', (_req, res) => {
            res.status(200).json({ ok: true });
        });
        app.useGlobalPipes(new common_1.ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }));
        const port = Number(process.env.PORT || 3000);
        await app.listen(port, '0.0.0.0');
        logger.log(`Service started successfully on port ${port}`);
    }
    catch (error) {
        logger.error('Service failed to start', error);
        process.exit(1);
    }
}
void bootstrap();
//# sourceMappingURL=main.js.map