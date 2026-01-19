export interface IneData {
  nombre: string;
  domicilio: string;
  claveElector: string;
  curp: string;
  anoRegistro: string;
  estado: string;
  municipio: string;
  seccion: string;
  localidad: string;
  emision: string;
  vigencia: string;
  sexo: string;
  fechaNacimiento?: string;
  foto?: string; // Data URL
  firma?: string; // Data URL
  // Back fields
  ocr?: string;
  cic?: string;
  identificador?: string;
  huella?: string; // Data URL for fingerprint
}

export const initialIneData: IneData = {
  nombre: "SANMIGUEL\nAGUILAR\nGERARDO",
  domicilio: "AND NARANJO C LOTE 1 MZA 109\nCOL LA ESPERANZA V DE LAS G 28219\nMANZANILLO, COL.",
  claveElector: "SNAGGR98030506H500",
  curp: "SAAG980305HCMNGR05",
  anoRegistro: "2016 03",
  fechaNacimiento: "05/03/1998",
  estado: "09",
  municipio: "004",
  seccion: "0250",
  localidad: "0001",
  emision: "2016",
  vigencia: "2023-2033",
  sexo: "H",
  firma: "",
  ocr: "IDMEX2620530367<<0250106457695\n9803053H3312315MEX<03<<06440<7\nSANMIGUEL<AGUILAR<<GERARDO<<<<",
  cic: "145689723",
  identificador: "1234567890",
  huella: "",
};
