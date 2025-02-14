import { Request, Response } from 'express';
import axios from 'axios';
const twilio = require("twilio");

// Mapas para mantener el estado del flujo.
const pendingCedula: Map<string, boolean> = new Map();           // Usuarios que aún deben enviar su cédula.
const authenticatedUsers: Map<string, any> = new Map();            // Objeto jugador autenticado.
const pendingMatchSelection: Map<string, any[]> = new Map();       // Lista de partidos disponibles para cada usuario.
const selectedMatch: Map<string, any> = new Map();                 // Objeto del partido seleccionado para cada usuario.

export class WhatsappController {

  public autenticar = async (req: Request, res: Response): Promise<void> => {
    const body = req.body;
    const idUsuario = body.From;          // Ejemplo: "+573188216823"
    const mensaje = body.Body.trim();       // Puede ser: cédula, selección de partido o una opción del menú

    
    // --- Flujo A: Usuario NO autenticado ---
    if (!this.isAuthenticated(idUsuario)) {
      if (!pendingCedula.has(idUsuario)) {
        pendingCedula.set(idUsuario, true);
        this.mensajeAlUsuario(res, "Hola, bienvenido al chat del equipo La Naranja Mecánica. Por favor, digita tu cédula para continuar.");
        return;
      } else {
        try {
          const response = await axios.get(`https://gestionpartidos-production.up.railway.app/jugadores/jugadorporcedula/${mensaje}`);
          const nombre = response.data.nombre_corto;
          const telefonoRegistrado = response.data.telefono;  // Ejemplo: "3188216823"
          const idJugador = response.data.id;
          
          if (!this.existeTelefono(telefonoRegistrado, idUsuario)) {
            pendingCedula.delete(idUsuario);
            this.mensajeAlUsuario(res, "El número de WhatsApp no coincide con el número registrado. Por favor, verifica.");
            return;
          }
          
          await axios.put(`https://gestionpartidos-production.up.railway.app/jugadores/${idJugador}`, { "id_telegram": idUsuario });
          pendingCedula.delete(idUsuario);
          authenticatedUsers.set(idUsuario, response.data);
          
          const listaPartidos = await this.obtenerListaPartidos();
          const partidosVigentes = await this.obtenerPartidosVigentes();
          pendingMatchSelection.set(idUsuario, partidosVigentes);
          
          // Se envía el mensaje de confirmación SIN el menú.
          this.mensajeAlUsuario(res, `Hola ${nombre}, gracias por autenticarte.\n\n${listaPartidos}`);
          return;
        } catch (error) {
          pendingCedula.delete(idUsuario);
          this.mensajeAlUsuario(res, "No se encontró el usuario con esa cédula. Por favor, verifica e intenta de nuevo.");
          return;
        }
      }
    }

    // --- Flujo B: Usuario autenticado ---
    if (this.isAuthenticated(idUsuario)) {
      if (pendingMatchSelection.has(idUsuario)) {
        const matchIndex = parseInt(mensaje);
        const matches = pendingMatchSelection.get(idUsuario);
        if (!matches || isNaN(matchIndex) || matchIndex < 1 || matchIndex > matches.length) {
          this.mensajeAlUsuario(res, "Número de partido inválido. Por favor, intenta de nuevo.");
          return;
        }
        const partidoSeleccionado = matches[matchIndex - 1];
        selectedMatch.set(idUsuario, partidoSeleccionado);
        // Se muestra el menú de opciones personalizado para el partido seleccionado.
        const menu = this.getMenuForMatch(partidoSeleccionado);
        this.mensajeAlUsuario(res, menu);
        pendingMatchSelection.delete(idUsuario);
        return;
      } else {
        switch (mensaje) {
          case "1": // Opción Convocarme
            {
              const jugador = authenticatedUsers.get(idUsuario);
              const match = selectedMatch.get(idUsuario);
              if (!jugador || !match) {
                this.mensajeAlUsuario(res, "Faltan datos para procesar tu solicitud. Por favor, revisa la lista de partidos.");
                return;
              }
              try {
                await axios.post(`https://gestionpartidos-production.up.railway.app/partido_jugadores/create_idjugador_idpartido`, {
                  id_jugador: jugador.id,
                  id_partido: match.id
                });
                this.mensajeAlUsuario(res, "Has sido convocado al partido exitosamente.\n\n" + this.getMenuForMatch(match));
              } catch (error) {
                this.mensajeAlUsuario(res, "Ya estás registrado en ese partido. Por favor, revisa el listado.\n\n" + this.getMenuForMatch(match));
              }
            }
            return;
          case "2": // Opción Desconvocarme
            {
              const jugador = authenticatedUsers.get(idUsuario);
              const match = selectedMatch.get(idUsuario);
              if (!jugador || !match) {
                this.mensajeAlUsuario(res, "Faltan datos para procesar tu solicitud. Por favor, revisa la lista de partidos.");
                return;
              }
              try {
                await axios.delete(`https://gestionpartidos-production.up.railway.app/partido_jugadores/delete_id_jugador_id_partido/${jugador.id}/${match.id}`);
                this.mensajeAlUsuario(res, "Has sido desconvocado del partido exitosamente.\n\n" + this.getMenuForMatch(match));
              } catch (error) {
                this.mensajeAlUsuario(res, "No estás registrado en ese partido o ya te desconvocaste. Por favor, revisa el listado.\n\n" + this.getMenuForMatch(match));
              }
            }
            return;
          case "3": // Opción Ver Listado de Jugadores
            {
              const listadoJugadores = await this.obtenerListadoJugadores(idUsuario);
              // Se concatena el menú personalizado después del listado.
              const menu = this.getMenuForMatchById(idUsuario);
              this.mensajeAlUsuario(res, listadoJugadores + "\n\n" + menu);
            }
            return;
          case "4": // Opción Salir: reiniciar el flujo
            {
              authenticatedUsers.delete(idUsuario);
              pendingMatchSelection.delete(idUsuario);
              selectedMatch.delete(idUsuario);
              pendingCedula.delete(idUsuario);
              this.mensajeAlUsuario(res, "Has salido de la gestión del partido. Por favor, digita cualquier tecla para volver a empezar.");
            }
            return;
          default:
            {
              const menu = this.getMenu();
              this.mensajeAlUsuario(res, "Opción no reconocida. Por favor, selecciona una opción válida.\n\n" + menu);
            }
            return;
        }
      }
    }

    this.mensajeAlUsuario(res, "Mensaje no reconocido. Intenta de nuevo.");
    return;
  };

  // Método para obtener el menú de opciones personalizado según el partido seleccionado.
  private getMenuForMatch = (match: any): string => {
    const fechaFormateada = this.formatFecha(match.fecha);
    return `Seleccione una opción para el partido del ${fechaFormateada} a las ${match.hora} en ${match.lugar}:\n1. Convocarme.\n2. Desconvocarme.\n3. Ver Listado de Jugadores.\n4. Salir.`;
  };

  // Método para obtener el menú personalizado basado en el partido seleccionado almacenado.
  private getMenuForMatchById = (idUsuario: string): string => {
    if (selectedMatch.has(idUsuario)) {
      const match = selectedMatch.get(idUsuario);
      return this.getMenuForMatch(match);
    }
    return this.getMenu();
  };

  // Método para obtener el menú genérico.
  private getMenu = (): string => {
    return "Seleccione una opción:\n1. Convocarme.\n2. Desconvocarme.\n3. Ver Listado de Jugadores.\n4. Salir.";
  };

  private obtenerListaPartidos = async (): Promise<string> => {
    try {
      const partidosResponse = await axios.get(`https://gestionpartidos-production.up.railway.app/partidos`);
      const partidos = partidosResponse.data;
      const hoy = new Date();
      const hoyMidnight = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const partidosVigentes = partidos.filter((p: any) => {
        const fechaPartido = new Date(p.fecha);
        return fechaPartido >= hoyMidnight;
      });
      if (partidosVigentes.length === 0) {
        return "No hay partidos vigentes en este momento.";
      }
      let listaPartidos = "Listado de Partidos Disponibles:\n\n";
      partidosVigentes.forEach((p: any, index: number) => {
        const fechaFormateada = this.formatFecha(p.fecha);
        listaPartidos += `${index + 1}. Partido: ${fechaFormateada}, a las ${p.hora} en ${p.lugar}.\n`;
      });
      listaPartidos += "\nPor favor, digita el número del partido que deseas gestionar.";
      return listaPartidos;
    } catch (error) {
      return "Error al obtener los partidos disponibles.";
    }
  };

  private obtenerPartidosVigentes = async (): Promise<any[]> => {
    try {
      const partidosResponse = await axios.get(`https://gestionpartidos-production.up.railway.app/partidos`);
      const partidos = partidosResponse.data;
      const hoy = new Date();
      const hoyMidnight = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const partidosVigentes = partidos.filter((p: any) => {
        const fechaPartido = new Date(p.fecha);
        return fechaPartido >= hoyMidnight;
      });
      return partidosVigentes;
    } catch (error) {
      return [];
    }
  };

  private obtenerListadoJugadores = async (idUsuario: string): Promise<string> => {
    const idPartido = selectedMatch.get(idUsuario)?.id || (selectedMatch.get(idUsuario) ? selectedMatch.get(idUsuario).id : null);
    if (!idPartido) {
      return "No se encontró el partido seleccionado. Por favor, intenta de nuevo.";
    }
    try {
      const listadoResponse = await axios.get(`https://gestionpartidos-production.up.railway.app/partido_jugadores/partidojugadores_idpartido/${idPartido}`);
      const data = listadoResponse.data;
      const fechaFormateada = this.formatFecha(data.fecha);
      const horaFormateada = this.formatHora(data.tipo_partido);
      const lugar = data.lugar;
      const numJugadores = data.Numero_Jugadores || (data.jugadores ? data.jugadores.length : 0);
      let mensajeListado = "-----------------------------------\n";
      mensajeListado += `Fecha: ${fechaFormateada}\n`;
      mensajeListado += `Lugar: ${lugar}\n`;
      mensajeListado += `Hora: ${horaFormateada}\n`;
      mensajeListado += `Numero de Jugadores: ${numJugadores}\n`;
      mensajeListado += "-------------------\n";
      if (data.jugadores && Array.isArray(data.jugadores)) {
        data.jugadores.forEach((jugador: any, index: number) => {
          const asterisco = jugador.estado_pago ? "* " : "";
          mensajeListado += `${index + 1}- ${jugador.nombre_corto} ${asterisco} \n`;
        });
      }
      mensajeListado += `-------------------\n`;
      mensajeListado += `🔴🔴 🔴🔴🔴🔴 🔴🔴🔴🔴 🔴🔴🔴🔴 \n`
      mensajeListado += `Se debe cancelar $18.000. Plazo para consignar hasta el Miércoles a las 8 pm \n` 
      mensajeListado += `🔴🔴 🔴🔴🔴🔴 🔴🔴🔴🔴 🔴🔴🔴🔴 \n`
      mensajeListado += ` Bancolombia\n`
      mensajeListado += `Número de Cuenta  75687416244 Ahorros \n`
      mensajeListado += `Fabio Alejandro Quintero Cédula 4.375.857\n`
      mensajeListado += `Daviplata: 3188216823\n`
      mensajeListado += `Nequi : 3188216823\n`
      mensajeListado += `Dale: 3188216823\n`
      mensajeListado += `-------------------\n`;
      return mensajeListado;
    } catch (error) {
      return "No hay jugadores seleccionados para ese partido.";
    }
  };

  public mensajeAlUsuario = (res: Response, texto: string): void => {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(texto);
    res.type("text/xml").send(twiml.toString());
  };

  public existeTelefono = (telefono: string, id_whatsapp: string): boolean => {
    return id_whatsapp.includes(telefono);
  };

  private formatFecha = (fecha: string): string => {
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const [year, month, day] = fecha.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const diaSemana = dias[dateObj.getDay()];
    return `${diaSemana} ${day} de ${meses[month - 1]}`;
  };

  private formatHora = (tipo: string): string => {
    const parts = tipo.split(" ");
    if (parts.length >= 2) {
      const hour = parts[1];
      return hour + ":00";
    }
    return "";
  };

  public isAuthenticated = (idUsuario: string): boolean => {
    return authenticatedUsers.has(idUsuario);
  };
}
