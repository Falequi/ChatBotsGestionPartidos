import express, { Router } from 'express'

interface Options {
    port: number;
    routes: Router;
    public_path?: string;
}

export class Server {

    private app = express();
    private readonly port: number;
    private readonly publicPath: string;
    private readonly routes: Router;

    constructor(options: Options) {

        const { port, routes, public_path = 'public' } = options;

        this.port = port;
        this.publicPath = public_path;
        this.routes = routes;
    }

    async start() {

        //* Middlewares
        this.app.use( express.json()); //Para recibir datos tipo raw
        this.app.use( express.urlencoded({ extended: true})); //Para recibir datos tipo x-www-form-urlencode

        //* Public Folder
        this.app.use(express.static(this.publicPath));

        //*Routes
        this.app.use(this.routes);


        this.app.listen(this.port, () => {
            console.log(`Server runnin on port ${this.port}`);
        });

    }

}