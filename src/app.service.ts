import { Injectable, NotFoundException } from "@nestjs/common";
import axios from "axios";
import * as unzipper from "unzipper";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

import { Customer } from "./entities/customer.entity";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Cron } from "@nestjs/schedule";
import { firstValueFrom } from "rxjs";
import { HttpService } from "@nestjs/axios";

@Injectable()
export class AppService {
	constructor(
		@InjectModel(Customer.name) private customerModel: Model<Customer>,
		private readonly httpService: HttpService,
	) {}

	@Cron("0 0 2 * * *") //Ejecutara el servicio todos los dias a las 2:00 a.m.
	async downloadFile(): Promise<void> {
		const url = "http://www2.sunat.gob.pe/padron_reducido_ruc.zip";
		const downloadFolder = path.join(__dirname, "assets", "downloads");

		try {
			await this.ensureDirectoryExists(downloadFolder);

			const response = await axios.get(url, {
				responseType: "stream",
			});

			const filePath = path.join(downloadFolder, "padron_reducido_ruc.zip");
			const writer = fs.createWriteStream(filePath);

			response.data.pipe(writer);

			return new Promise((resolve, reject) => {
				writer.on("finish", resolve);
				writer.on("error", reject);
			});
		} catch (error) {
			throw new Error(`No se pudo descargar el archivo: ${error.message}`);
		}
	}

	@Cron("0 0 3 * * *") //Ejecutara el servicio todos los dias a las 3:00 a.m.
	async extractZip(): Promise<string> {
		try {
			const zipFilePath = path.join(__dirname, "assets", "downloads", "padron_reducido_ruc.zip");
			const extractFolder = path.join(__dirname, "assets", "downloads");
			// Verificamos si el archivo existe
			if (!fs.existsSync(zipFilePath)) {
				throw new NotFoundException(`El archivo no existe`);
			}

			await fs
				.createReadStream(zipFilePath)
				.pipe(unzipper.Extract({ path: extractFolder }))
				.promise();

			// Eliminar el archivo ZIP después de la extracción
			fs.unlinkSync(zipFilePath);

			return "Extracción completada";
		} catch (error) {
			throw new Error(`No se pudo extraer el archivo: ${error.message}`);
		}
	}

	@Cron("0 0 4 * * *") //Ejecutara el servicio todos los dias a las 4:00 a.m.
	async importFromFile(): Promise<void> {
		const filePath = path.join(__dirname, "assets", "downloads", "padron_reducido_ruc.txt");

		if (!fs.existsSync(filePath)) {
			throw new NotFoundException(`El archivo no existe`);
		}

		const fileStream = fs.createReadStream(filePath, { encoding: "latin1" });
		const rl = readline.createInterface({
			input: fileStream,
			crlfDelay: Infinity,
		});

		let counter = 0;
		let isFirstLine = true;
		const bulkOperations = [];
		const batchSize = 500000; // Tamaño del lote reducido
		const startTime = Date.now(); // Tiempo de inicio

		// Procesar cada línea del archivo
		for await (const line of rl) {
			if (isFirstLine) {
				isFirstLine = false;
				continue; // Omitir encabezado
			}

			// Desestructuración y asignación de valores de la línea
			const [
				ruc,
				razon_social,
				estado,
				condicion,
				ubicacion,
				tipo_calle,
				nombre_calle,
				codigo_zona,
				tipo_zona,
				numero,
				interior,
				lote,
				departamento,
				manzana,
				km,
			] = line.split("|");

			// Agregar la operación de actualización a bulkOperations
			bulkOperations.push({
				updateOne: {
					filter: { ruc },
					update: {
						ruc,
						razon_social,
						estado,
						condicion,
						ubicacion,
						tipo_calle,
						nombre_calle,
						codigo_zona,
						tipo_zona,
						numero,
						interior,
						lote,
						departamento,
						manzana,
						km,
					},
					upsert: true,
				},
			});

			// Si se alcanza el tamaño del lote, ejecutar bulkWrite
			if (bulkOperations.length >= batchSize) {
				await this.executeBulkWrite(bulkOperations);
				bulkOperations.length = 0; // Limpiar el lote
			}

			counter++;
		}

		// Procesar el último lote si queda alguna operación pendiente
		if (bulkOperations.length > 0) {
			await this.executeBulkWrite(bulkOperations);
		}

		const endTime = Date.now();
		const durationInSeconds = (endTime - startTime) / 1000; // Duración en segundos

		const hours = Math.floor(durationInSeconds / 3600);
		const minutes = Math.floor((durationInSeconds % 3600) / 60);
		const seconds = Math.floor(durationInSeconds % 60);

		console.log(
			`Archivo procesado en ${hours} horas, ${minutes} minutos y ${seconds} segundos para ${counter} de registros.`,
		);
	}

	async findCustomerByNumber(number: string): Promise<any> {
		const filter = number.length > 8 ? { ruc: number } : { ruc: new RegExp(`^10${number}\\d$`) };
		const customer = await this.customerModel.findOne(filter).lean().exec();

		if (!customer) {
			throw new NotFoundException(`Customer with value ${number} not found`);
		}

		const { ruc, razon_social, ubicacion, ...rest } = customer; // Desestructuración

		// Mapeo de los valores y sus correspondientes prefijos
		const addressParts = [
			{ value: customer.tipo_calle, prefix: "" },
			{ value: customer.nombre_calle, prefix: "" },
			{ value: customer.km, prefix: "KM. " },
			{ value: customer.manzana, prefix: "MZA. " },
			{ value: customer.lote, prefix: "LOTE. " },
			{ value: customer.numero, prefix: "NRO. " },
			{ value: customer.departamento, prefix: "DTPO. " },
			{ value: customer.interior, prefix: "INT. " },
			{ value: customer.codigo_zona, prefix: "" },
			{ value: customer.tipo_zona, prefix: "" },
		];

		// Filtrar y concatenar las partes que no son "-"
		const direccion_completa = addressParts
			.filter((part) => part.value !== "-") // Solo incluye partes válidas
			.map((part) => `${part.prefix}${part.value}`) // Aplica el prefijo y el valor
			.join(" "); // Une todas las partes en una cadena completa

		const response = {
			ruc_o_dni: number,
			razon_social_o_nombre: razon_social,
			ubigeo: ubicacion,
			direccion_completa,
			...rest, // Copiar el resto de los campos
		};

		return response;
	}

	private async ensureDirectoryExists(directory: string): Promise<void> {
		try {
			await fs.promises.access(directory, fs.constants.F_OK);
		} catch (err) {
			if (err.code === "ENOENT") {
				await fs.promises.mkdir(directory, { recursive: true });
				console.log(`Directorio creado: ${directory}`);
			} else {
				throw err;
			}
		}
	}

	private async executeBulkWrite(bulkOperations: any[]): Promise<void> {
		const startTimeBatch = Date.now();
		try {
			// Especificamos 'ordered: false' para mejorar el rendimiento
			await this.customerModel.bulkWrite(bulkOperations, { ordered: false });
		} catch (error) {
			console.error("Error en bulkWrite:", error);
		}
		const endTimeBatch = Date.now();
		const batchDuration = (endTimeBatch - startTimeBatch) / 1000;
		console.log(`Lote procesado en ${batchDuration} segundos.`);
	}

	async getSunatToken(payload?: any): Promise<any> {
		try {
			const url =
				"https://api-seguridad.sunat.gob.pe/v1/clientessol/4f3b88b3-d9d6-402a-b85d-6a0bc857746a/oauth2/j_security_check";

			const formData = new URLSearchParams({
				tipo: "2",
				dni: "",
				custom_ruc: "10441054209",
				j_username: "JMPIPAHY",
				j_password: "Jpipah11@@",
				captcha: "",
				originalUrl: "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm",
				lang: "es-PE",
				state:
					"rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAAEZXhlY3B0AAZwYXJhbXN0AEsqJiomL2NsLXRpLWl0bWVudS9NZW51SW50ZXJuZXQuaHRtJmI2NGQyNmE4YjVhZjA5MTkyM2IyM2I2NDA3YTFjMWRiNDFlNzMzYTZ0AANleGVweA",
			});

			const response = await firstValueFrom(
				this.httpService.request<any>({
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Cookie:
							"MENU-SOL-LANGUAGE=es-PE; _ga_6LRF6GC6EC=GS1.1.1736041646.8.0.1736041646.0.0.0; _gid=GA1.3.67379075.1736405403; _ga=GA1.3.1023738658.1729467598; _ga_6NCEEN6JSV=GS1.1.1736606633.27.0.1736606635.0.0.0; MENUTIPOLOGIN=2; TS019e7fc2=019edc9eb8a2e2730e0882964a7caf14cf6a614a8434823ee11e2c8940dbe0dbddef36f1661c577433537b3fad72fd25a7958fbd7c",
					},
					url: url,
					method: "POST",
					data: formData.toString(),
					maxRedirects: 0, // No seguir automáticamente redirecciones
					validateStatus: (status) => status < 400 || status === 302, // Aceptar redirecciones
				}),
			);

			if (response.status === 302 && response.headers["location"]) {
				// Manejar redirección
				const redirectUrl = response.headers["location"];
				console.log("Redirigiendo a:", redirectUrl);

				// Realiza la nueva solicitud a la URL proporcionada en 'location'
				const redirectResponse = await firstValueFrom(this.httpService.get(redirectUrl));

				console.log("Respuesta tras redirección:", redirectResponse.data);
				return redirectResponse.data;
			}

			console.log("Respuesta recibida:", response.data);
			return response.data;
			// return response.data;
		} catch (error) {
			console.log("error", error);
		}
	}
}
