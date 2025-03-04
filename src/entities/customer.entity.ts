import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

@Schema({ timestamps: true })
export class Customer extends Document {
	@Prop({ trim: true, index: true })
	ruc: string;

	@Prop({ trim: true, index: true })
	razon_social: string;

	@Prop({ trim: true })
	estado: string;

	@Prop({ trim: true })
	condicion: string;

	@Prop({ trim: true })
	ubicacion: string;

	@Prop({ trim: true })
	tipo_calle: string;

	@Prop({ trim: true })
	nombre_calle: string;

	@Prop({ trim: true })
	codigo_zona: string;

	@Prop({ trim: true })
	tipo_zona: string;

	@Prop({ trim: true })
	numero: string;

	@Prop({ trim: true })
	interior: string;

	@Prop({ trim: true })
	lote: string;

	@Prop({ trim: true })
	departamento: string;

	@Prop({ trim: true })
	manzana: string;

	@Prop({ trim: true })
	km: string;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.methods.toJSON = function () {
	const { __v, password, isTfaEabled, tfaSecret, ...record } = this.toObject();

	return record;
};

/** Excluimos los campos que no deseamos mostrar */
CustomerSchema.methods.toJSON = function () {
	const { __v, _id, updatedAt, createdAt, ...record } = this.toObject();
	return record;
};
