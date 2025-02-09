import { Router } from "express";
import { WhatsappController } from "./whatsapp.controller";


export class WhatsappRoutes {

    static get routes(): Router {
        const router = Router();

        const whatsappController = new WhatsappController();

        router.get('', whatsappController.saludo);

        return router;
    }
}