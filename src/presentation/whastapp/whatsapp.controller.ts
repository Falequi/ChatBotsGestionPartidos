import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { AxiosError } from 'axios';
const twilio = require("twilio");

// Definición de la interfaz para un jugador, según tu modelo en Prisma
interface Jugador {
  id: number;
  nombres: string;
  telefono: string;
  id_telegram?: string; // Propiedad opcional
}

// URL base de la API para jugadores
const API_BASE_URL = "https://gestionpartidos-production.up.railway.app/jugadores";

// Map para manejar el estado pendiente de autenticación (clave: número sin código de país)
const pendingAuth: Map<string, boolean> = new Map();

export class WhatsappController {
  /**
   * Método que gestiona la autenticación del usuario.
   * Se elimina el prefijo "whatsapp:" y el código de país (por ejemplo, "+57") del número.
   * Luego, se compara con el campo "telefono" del jugador obtenido por cédula.
   * Si coinciden, se actualiza el registro usando el endpoint PUT.
   */
  public autenticar = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response<any, Record<string, any>>> => {
    const { Body, From } = req.body;
    const message = Body.trim();

    // Extraer el número sin el prefijo "whatsapp:"
    let rawPhone = From.replace("whatsapp:", "").trim();

    // Quitar el código de país, asumiendo que es "+57" o "57"
    if (rawPhone.startsWith("+57")) {
      rawPhone = rawPhone.substring(3);
    } else if (rawPhone.startsWith("57")) {
      rawPhone = rawPhone.substring(2);
    }
    console.log(`Mensaje recibido de ${rawPhone}: ${message}`);

    try {
      // 1. Verificar si el usuario ya está autenticado (si existe un jugador con id_telegram igual a rawPhone)
      let jugadorRegistrado: Jugador | null = null;
      try {
        const response = await axios.get(API_BASE_URL);
        const jugadores: Jugador[] = response.data;
        jugadorRegistrado = jugadores.find(j => j.id_telegram === rawPhone) || null;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Error al obtener jugadores:", error.message);
        } else {
          console.error("Error al obtener jugadores:", error);
        }
      }
      if (jugadorRegistrado) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`⚽ ¡Hola ${jugadorRegistrado.nombres}, ya estás autenticado!`);
        return res.type("text/xml").send(twiml.toString());
      }

      // 2. Si el usuario no está autenticado, revisar si ya se le pidió la cédula.
      if (!pendingAuth.has(rawPhone)) {
        pendingAuth.set(rawPhone, true);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("👋 Para autenticarte, por favor envía tu número de cédula.");
        return res.type("text/xml").send(twiml.toString());
      }

      // 3. Se asume que el mensaje recibido es la cédula.
      const cedula = message;
      console.log(`Buscando jugador por cédula: ${cedula}`);
      let jugador: Jugador | null = null;
      try {
        const responseCedula = await axios.get(`${API_BASE_URL}/jugadorporcedula/${cedula}`);
        const data = responseCedula.data;
        // Validar si la respuesta indica un error (por ejemplo, { "error": {} }).
        if (data && data.error !== undefined) {
          if (Object.keys(data.error).length === 0) {
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(`❌ No se encontró la cédula ${cedula} en el sistema. Por favor, verifica e intenta de nuevo.`);
            return res.type("text/xml").send(twiml.toString());
          }
        }
        jugador = data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (
            error.response &&
            (error.response.status === 404 ||
             (typeof error.response.data === "string" && error.response.data.includes("Cannot GET")))
          ) {
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(`❌ No se encontró la cédula ${cedula} en el sistema. Por favor, verifica e intenta de nuevo.`);
            return res.type("text/xml").send(twiml.toString());
          } else {
            console.error("Error al obtener la cédula:", error.message);
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message("⚠️ Ocurrió un error al procesar tu solicitud. Intenta más tarde.");
            return res.type("text/xml").send(twiml.toString());
          }
        } else {
          console.error("Error al obtener la cédula:", error);
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message("⚠️ Ocurrió un error al procesar tu solicitud. Intenta más tarde.");
          return res.type("text/xml").send(twiml.toString());
        }
      }

      // 4. Comparar el número recibido (rawPhone) con el campo "telefono" del jugador.
      if (jugador) {
        if (jugador.telefono !== rawPhone) {
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(`❌ El número de WhatsApp (${rawPhone}) no coincide con el número registrado (${jugador.telefono}).`);
          return res.type("text/xml").send(twiml.toString());
        }
        // 5. Si coincide, actualizar el registro asignando id_telegram usando el endpoint PUT.
        try {
          await axios.put(`${API_BASE_URL}/${jugador.id}`, { id_telegram: rawPhone });
        } catch (error) {
          if (axios.isAxiosError(error)) {
            console.error("Error al actualizar id_telegram:", error.message);
          } else {
            console.error("Error al actualizar id_telegram:", error);
          }
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message("⚠️ Hubo un error al actualizar tu registro. Intenta más tarde.");
          return res.type("text/xml").send(twiml.toString());
        }
        pendingAuth.delete(rawPhone);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`✅ Registro exitoso, ${jugador.nombres}! Ahora estás autenticado.`);
        return res.type("text/xml").send(twiml.toString());
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Error general en autenticación:", error.message);
      } else {
        console.error("Error general en autenticación:", error);
      }
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("⚠️ Ocurrió un error al procesar tu solicitud. Intenta más tarde.");
      return res.type("text/xml").send(twiml.toString());
    }
    // Agregar un retorno final para asegurar que la función siempre retorne algo.
    return res.end();
  }
}
