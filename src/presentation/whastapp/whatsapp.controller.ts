import { Request, Response } from 'express';
const twilio = require("twilio");



export class WhatsappController {

    public saludo = (req: Request, res: Response) => {
        const message = req.body.Body; // Mensaje recibido en WhatsApp
        const from = req.body.From; // Número de WhatsApp del remitente

        // Responder automáticamente con Twilio
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`📢 Recibí tu mensaje: Pronto responderé.`);

        res.type("text/xml").send(twiml.toString());

    }
}