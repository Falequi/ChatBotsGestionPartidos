// src/presentation/routes.ts
import { Router } from 'express';
import { WhatsappController } from './whastapp/whatsapp.controller';

export class AppRoutes {
    static get routes(): Router {
        const router = Router();
        const whatsappController = new WhatsappController();

        // Envolver el método asíncrono con asyncHandler
        router.post('/webhook', whatsappController.autenticar);

        return router;
    }
}
