"use client";

import React, { useMemo, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Text, Rect, Line, Circle } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import useImage from "use-image";
import { IneData, initialIneData } from "@/types/ine";
import { Download, Upload, Move, Check, Paintbrush, FileImage, RotateCcw } from "lucide-react";

// Default template paths
const FRONT_TEMPLATE = "/ine-front.png";
const BACK_TEMPLATE = "/ine-back.png";

interface Position {
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

type CardCorners = [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];

const BASE_WIDTH = 660;
const BASE_HEIGHT = 440;
const FONT_FAMILY = "Arial Narrow, Arial, sans-serif";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const computeHomography = (
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point]
) => {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }

    const pivot = M[pivotRow][col];
    if (Math.abs(pivot) < 1e-10) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const invPivot = 1 / M[col][col];
    for (let c = col; c <= n; c++) M[col][c] *= invPivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  const x = M.map((row) => row[n]);
  const [a, b1, c1, d, e, f, g, h] = x;

  return {
    a,
    b: b1,
    c: c1,
    d,
    e,
    f,
    g,
    h,
  };
};

const applyHomography = (
  H:
    | {
        a: number;
        b: number;
        c: number;
        d: number;
        e: number;
        f: number;
        g: number;
        h: number;
      }
    | null,
  p: Point
): Point => {
  if (!H) return p;
  const den = H.g * p.x + H.h * p.y + 1;
  if (Math.abs(den) < 1e-10) return p;
  return {
    x: (H.a * p.x + H.b * p.y + H.c) / den,
    y: (H.d * p.x + H.e * p.y + H.f) / den,
  };
};

const initialPositions: Record<string, Position> = {
  foto: { x: 42, y: 162 },
  ghostFoto: { x: 500, y: 200 },
  
  // Top Row (Aligned with top of Name block)
  labelNombre: { x: 200, y: 172 },
  nombre: { x: 200, y: 184 },
  
  labelSexo: { x: 480, y: 172 },
  sexo: { x: 515, y: 172 }, // Value next to label

  // Middle Block
  labelDomicilio: { x: 200, y: 242 },
  domicilio: { x: 200, y: 254 },

  // Clave Elector Row
  labelClaveElector: { x: 200, y: 312 },
  claveElector: { x: 310, y: 312 }, // Same line as label

  // Bottom Block - Row 1
  labelCurp: { x: 200, y: 337 },
  curp: { x: 200, y: 349 },
  
  labelAnoRegistro: { x: 400, y: 337 },
  anoRegistro: { x: 400, y: 349 },

  // Bottom Block - Row 2
  labelFechaNacimiento: { x: 200, y: 377 },
  fechaNacimiento: { x: 200, y: 389 },
  
  labelSeccion: { x: 320, y: 377 },
  seccion: { x: 320, y: 389 },
  
  labelVigencia: { x: 400, y: 377 },
  vigencia: { x: 400, y: 389 },

  // Signatures and Back
  firma: { x: 380, y: 292 },
  ocr: { x: 50, y: 450 },
  cic: { x: 500, y: 150 },
  identificador: { x: 500, y: 180 },
  huella: { x: 50, y: 150 },
};

const IneCanvas = ({
  data,
  templateImage,
  positions,
  isEditing,
  onUpdatePosition,
  isCalibrating,
  usePerspective,
  cardCorners,
  onUpdateCorner,
  showPatches,
  patchColor,
  activeSide,
}: {
  data: IneData;
  templateImage: HTMLImageElement | undefined;
  positions: Record<string, Position>;
  isEditing: boolean;
  onUpdatePosition: (key: string, x: number, y: number) => void;
  isCalibrating: boolean;
  usePerspective: boolean;
  cardCorners: CardCorners;
  onUpdateCorner: (index: 0 | 1 | 2 | 3, x: number, y: number) => void;
  showPatches: boolean;
  patchColor: string;
  activeSide: 'front' | 'back';
}) => {
  const [userPhoto] = useImage(data.foto || "");
  const [signatureImage] = useImage(data.firma || "");
  const [fingerprintImage] = useImage(data.huella || "");

  const width = templateImage?.width ?? 0;
  const height = templateImage?.height ?? 0;

  const pixelCorners = useMemo<[Point, Point, Point, Point]>(() => {
    return [
      { x: cardCorners[0].x * width, y: cardCorners[0].y * height },
      { x: cardCorners[1].x * width, y: cardCorners[1].y * height },
      { x: cardCorners[2].x * width, y: cardCorners[2].y * height },
      { x: cardCorners[3].x * width, y: cardCorners[3].y * height },
    ];
  }, [cardCorners, height, width]);

  const perspectiveEnabled = usePerspective;

  const cardScale = useMemo(() => {
    if (!perspectiveEnabled) return width / BASE_WIDTH;
    const top = distance(pixelCorners[0], pixelCorners[1]);
    const bottom = distance(pixelCorners[3], pixelCorners[2]);
    const cardWidthPx = (top + bottom) / 2;
    return cardWidthPx / BASE_WIDTH;
  }, [perspectiveEnabled, pixelCorners, width]);

  const cardRotationDeg = useMemo(() => {
    if (!perspectiveEnabled) return 0;
    const tl = pixelCorners[0];
    const tr = pixelCorners[1];
    return (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  }, [perspectiveEnabled, pixelCorners]);

  const baseToImage = useMemo(() => {
    if (!perspectiveEnabled) return null;
    const src: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: BASE_WIDTH, y: 0 },
      { x: BASE_WIDTH, y: BASE_HEIGHT },
      { x: 0, y: BASE_HEIGHT },
    ];
    return computeHomography(src, pixelCorners);
  }, [perspectiveEnabled, pixelCorners]);

  const imageToBase = useMemo(() => {
    if (!perspectiveEnabled) return null;
    const dst: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: BASE_WIDTH, y: 0 },
      { x: BASE_WIDTH, y: BASE_HEIGHT },
      { x: 0, y: BASE_HEIGHT },
    ];
    return computeHomography(pixelCorners, dst);
  }, [perspectiveEnabled, pixelCorners]);

  const scale = cardScale;

  const textureCanvas = useMemo(() => {
    if (typeof window === "undefined") return null;
    const c = document.createElement("canvas");
    const size = 220;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    let seed = 1337;
    const rand01 = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand01() * 255) | 0;
      img.data[i] = n;
      img.data[i + 1] = n;
      img.data[i + 2] = n;
      img.data[i + 3] = 18;
    }
    ctx.putImageData(img, 0, 0);

    return c;
  }, []);

  const handleDragEnd = (key: string) => (e: KonvaEventObject<DragEvent>) => {
    const px = { x: e.target.x(), y: e.target.y() };
    if (perspectiveEnabled) {
      const base = applyHomography(imageToBase, px);
      onUpdatePosition(key, base.x, base.y);
      return;
    }
    onUpdatePosition(key, px.x / scale, px.y / scale);
  };

  const handleCornerDragEnd = (index: 0 | 1 | 2 | 3) => (e: KonvaEventObject<DragEvent>) => {
    const x = clamp01(e.target.x() / width);
    const y = clamp01(e.target.y() / height);
    onUpdateCorner(index, x, y);
  };

  // Helper to render text with an optional background patch
  const renderField = (
    key: string,
    text: string,
    fontSize: number = 11,
    width?: number,
    lineHeight?: number,
    fontFamily?: string,
    isLabel: boolean = false,
    letterSpacing?: number,
    forceBold: boolean = false,
    fill?: string,
    opacity?: number,
    shadowBlurBase?: number,
    shadowOpacity?: number
  ) => {
    const baseFontSize = isLabel ? 7.4 : fontSize;
    const finalFontSize = baseFontSize * scale;
    const finalLineHeight = isLabel ? 1 : lineHeight ?? 0.95;
    const finalFontFamily = fontFamily || FONT_FAMILY;
    const fontStyle = isLabel ? "normal" : forceBold ? "bold" : "normal";
    const textColor = fill ?? (isLabel ? "#5A5A5A" : "#2A2A2A");
    const textOpacity = opacity ?? (isLabel ? 1 : 0.92);
    const shadowBlur = (shadowBlurBase ?? (isLabel ? 0 : 0.55)) * scale;
    const shadowOp = shadowOpacity ?? (isLabel ? 0 : 0.22);
    const effectiveLetterSpacingBase =
      letterSpacing ?? (isLabel ? 0 : finalFontFamily.includes("Courier") ? 0 : -0.15);

    const basePos = { x: positions[key].x, y: positions[key].y };
    const mappedPos = perspectiveEnabled
      ? applyHomography(baseToImage, basePos)
      : { x: basePos.x * scale, y: basePos.y * scale };

    const lines = text.split("\n").length || 1;
    const patchWBase = width ?? text.length * (baseFontSize * 0.6);
    const patchHBase = baseFontSize * finalLineHeight * lines;

    const patchQuad = perspectiveEnabled
      ? (() => {
          const tl = applyHomography(baseToImage, { x: basePos.x - 2, y: basePos.y - 2 });
          const tr = applyHomography(baseToImage, { x: basePos.x + patchWBase + 2, y: basePos.y - 2 });
          const br = applyHomography(baseToImage, { x: basePos.x + patchWBase + 2, y: basePos.y + patchHBase + 2 });
          const bl = applyHomography(baseToImage, { x: basePos.x - 2, y: basePos.y + patchHBase + 2 });
          return [tl, tr, br, bl];
        })()
      : null;

    return (
      <>
        {showPatches &&
          (perspectiveEnabled && patchQuad ? (
            <Line
              points={patchQuad.flatMap((p) => [p.x, p.y])}
              closed
              fill={patchColor}
              listening={false}
            />
          ) : (
            <Rect
              x={mappedPos.x - 2 * scale}
              y={mappedPos.y - 2 * scale}
              width={patchWBase * scale + 4 * scale}
              height={patchHBase * scale + 4 * scale}
              fill={patchColor}
              draggable={isEditing}
              onDragEnd={handleDragEnd(key)}
            />
          ))}
        <Text
          text={text}
          x={mappedPos.x}
          y={mappedPos.y}
          fontSize={finalFontSize}
          fontFamily={finalFontFamily}
          fontStyle={fontStyle}
          fill={textColor}
          opacity={textOpacity}
          width={width ? width * scale : undefined}
          lineHeight={finalLineHeight}
          letterSpacing={effectiveLetterSpacingBase * scale}
          rotation={perspectiveEnabled ? cardRotationDeg : 0}
          shadowColor="#000000"
          shadowBlur={shadowBlur}
          shadowOpacity={shadowOp}
          shadowOffset={{ x: 0.35 * scale, y: 0.35 * scale }}
          draggable={isEditing}
          onDragEnd={handleDragEnd(key)}
        />
      </>
    );
  };

  if (!templateImage) {
    return <div className="text-gray-500">Cargando plantilla...</div>;
  }

  return (
    <Stage width={width} height={height} className="border shadow-lg bg-white">
      <Layer>
        {/* Background */}
        <KonvaImage image={templateImage} listening={false} />

        {textureCanvas && (
          <KonvaImage
            image={textureCanvas}
            x={0}
            y={0}
            width={width}
            height={height}
            opacity={0.07}
            globalCompositeOperation="multiply"
            listening={false}
          />
        )}

        {activeSide === 'front' && (
          <>
            {/* Patches for Photos if needed */}
            {showPatches &&
              (perspectiveEnabled ? (
                (() => {
                  const basePos = { x: positions.foto.x, y: positions.foto.y };
                  const w = 130;
                  const h = 170;
                  const tl = applyHomography(baseToImage, basePos);
                  const tr = applyHomography(baseToImage, { x: basePos.x + w, y: basePos.y });
                  const br = applyHomography(baseToImage, { x: basePos.x + w, y: basePos.y + h });
                  const bl = applyHomography(baseToImage, { x: basePos.x, y: basePos.y + h });

                  return (
                    <Line
                      points={[tl, tr, br, bl].flatMap((p) => [p.x, p.y])}
                      closed
                      fill={patchColor}
                      listening={false}
                    />
                  );
                })()
              ) : (
                <Rect
                  x={positions.foto.x * scale}
                  y={positions.foto.y * scale}
                  width={130 * scale}
                  height={160 * scale}
                  fill={patchColor}
                />
              ))}

            {/* User Photo */}
            {userPhoto && (
              <KonvaImage
                image={userPhoto}
                x={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.foto.x, y: positions.foto.y }).x
                    : positions.foto.x * scale
                }
                y={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.foto.x, y: positions.foto.y }).y
                    : positions.foto.y * scale
                }
                width={130 * scale}
                height={170 * scale}
                rotation={perspectiveEnabled ? cardRotationDeg : 0}
                draggable={isEditing}
                onDragEnd={handleDragEnd("foto")}
              />
            )}
            
            {/* Ghost Photo */}
             {userPhoto && (
             <KonvaImage
                image={userPhoto}
                x={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.ghostFoto.x, y: positions.ghostFoto.y }).x
                    : positions.ghostFoto.x * scale
                }
                y={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.ghostFoto.x, y: positions.ghostFoto.y }).y
                    : positions.ghostFoto.y * scale
                }
                width={50 * scale}
                height={60 * scale}
                opacity={0.6}
                rotation={perspectiveEnabled ? cardRotationDeg : 0}
                draggable={isEditing}
                onDragEnd={handleDragEnd("ghostFoto")}
              />
            )}

            {/* Signature */}
            {signatureImage && (
              <KonvaImage
                image={signatureImage}
                x={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.firma.x, y: positions.firma.y }).x
                    : positions.firma.x * scale
                }
                y={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.firma.x, y: positions.firma.y }).y
                    : positions.firma.y * scale
                }
                width={120 * scale}
                height={60 * scale}
                rotation={perspectiveEnabled ? cardRotationDeg : 0}
                draggable={isEditing}
                onDragEnd={handleDragEnd("firma")}
                globalCompositeOperation="multiply"
              />
            )}

            {/* NOMBRE */}
            {renderField("labelNombre", "NOMBRE", undefined, undefined, undefined, undefined, true)}
            {renderField("nombre", data.nombre, 11.5, 250, 0.92, undefined, false, -0.35, false, "#2F2F2F", 0.82, 0.85, 0.22)}

            {/* DOMICILIO */}
            {renderField("labelDomicilio", "DOMICILIO", undefined, undefined, undefined, undefined, true)}
            {renderField("domicilio", data.domicilio, 9.2, 280, 0.98)}

            {/* CLAVE ELECTOR */}
            {renderField("labelClaveElector", "CLAVE DE ELECTOR", undefined, undefined, undefined, undefined, true)}
            {renderField("claveElector", data.claveElector, 9.5)}

            {/* CURP */}
            {renderField("labelCurp", "CURP", undefined, undefined, undefined, undefined, true)}
            {renderField("curp", data.curp, 9.5)}
            
            {/* AÑO REGISTRO */}
            {renderField("labelAnoRegistro", "AÑO DE REGISTRO", undefined, undefined, undefined, undefined, true)}
            {renderField("anoRegistro", data.anoRegistro, 9.5)}

            {/* FECHA DE NACIMIENTO */}
            {renderField("labelFechaNacimiento", "FECHA DE NACIMIENTO", undefined, undefined, undefined, undefined, true)}
            {renderField("fechaNacimiento", data.fechaNacimiento || "", 9.5)}

            {/* SECCIÓN */}
            {renderField("labelSeccion", "SECCIÓN", undefined, undefined, undefined, undefined, true)}
            {renderField("seccion", data.seccion, 9.5)}

            {/* VIGENCIA */}
            {renderField("labelVigencia", "VIGENCIA", undefined, undefined, undefined, undefined, true)}
            {renderField("vigencia", data.vigencia, 9.5)}

            {/* SEXO */}
            {renderField("labelSexo", "SEXO", undefined, undefined, undefined, undefined, true)}
            {renderField("sexo", data.sexo, 9.5)}
          </>
        )}

        {activeSide === 'back' && (
            <>
                {/* Fingerprint */}
                {fingerprintImage && (
                  <KonvaImage
                    image={fingerprintImage}
                    x={
                      perspectiveEnabled
                        ? applyHomography(baseToImage, { x: positions.huella.x, y: positions.huella.y }).x
                        : positions.huella.x * scale
                    }
                    y={
                      perspectiveEnabled
                        ? applyHomography(baseToImage, { x: positions.huella.x, y: positions.huella.y }).y
                        : positions.huella.y * scale
                    }
                    width={100 * scale}
                    height={120 * scale}
                    rotation={perspectiveEnabled ? cardRotationDeg : 0}
                    draggable={isEditing}
                    onDragEnd={handleDragEnd("huella")}
                    globalCompositeOperation="multiply"
                  />
                )}

                {/* CIC */}
                {renderField("cic", data.cic || '', 12)}

                {/* Identificador */}
                {renderField("identificador", data.identificador || '', 12)}

                {/* OCR */}
                {renderField("ocr", data.ocr || '', 16, 600, 1, "Courier New")}
            </>
        )}
        
      </Layer>
      {isCalibrating && (
        <Layer>
          <Line
            points={pixelCorners.flatMap((p) => [p.x, p.y])}
            closed
            stroke="#00A3FF"
            strokeWidth={2}
            dash={[8, 6]}
            listening={false}
          />
          {pixelCorners.map((p, idx) => (
            <Circle
              key={`corner-${idx}`}
              x={p.x}
              y={p.y}
              radius={10}
              fill="#00A3FF"
              opacity={0.9}
              draggable
              onDragEnd={handleCornerDragEnd(idx as 0 | 1 | 2 | 3)}
            />
          ))}
        </Layer>
      )}
    </Stage>
  );
};

export default function IneEditor() {
  const [data, setData] = useState<IneData>(initialIneData);
  const [positions, setPositions] = useState(initialPositions);
  const [isEditing, setIsEditing] = useState(false);
  const [showPatches, setShowPatches] = useState(false); // Default false for blank templates
  const [patchColor, setPatchColor] = useState("#f4e7d7"); // Default approximated color

  const [usePerspective, setUsePerspective] = useState(true);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const fullCorners: CardCorners = useMemo(
    () => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    []
  );

  const refCorners: CardCorners = useMemo(
    () => [
      { x: 290 / 1280, y: (160 + 28) / 720 },
      { x: 1050 / 1280, y: (135 + 28) / 720 },
      { x: 1065 / 1280, y: (590 + 28) / 720 },
      { x: 275 / 1280, y: (610 + 28) / 720 },
    ],
    []
  );

  const [frontCardCorners, setFrontCardCorners] = useState<CardCorners>(fullCorners);
  const [backCardCorners, setBackCardCorners] = useState<CardCorners>(fullCorners);
  
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [frontTemplateSrc, setFrontTemplateSrc] = useState(FRONT_TEMPLATE);
  const [backTemplateSrc, setBackTemplateSrc] = useState(BACK_TEMPLATE);
  
  const [frontTemplateImage] = useImage(frontTemplateSrc);
  const [backTemplateImage] = useImage(backTemplateSrc);
  
  const templateImage = activeSide === 'front' ? frontTemplateImage : backTemplateImage;

  const isFullCorners = (corners: CardCorners) =>
    corners.every(
      (p, i) => Math.abs(p.x - fullCorners[i].x) < 1e-6 && Math.abs(p.y - fullCorners[i].y) < 1e-6
    );

  const displayedCardCorners: CardCorners =
    activeSide === "front"
      ? templateImage && templateImage.width === 1280 && templateImage.height === 720 && isFullCorners(frontCardCorners)
        ? refCorners
        : frontCardCorners
      : backCardCorners;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData((prev) => ({ ...prev, [name]: value }));
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (activeSide === 'front') {
            setFrontTemplateSrc(reader.result as string);
            setFrontCardCorners(fullCorners);
        } else {
            setBackTemplateSrc(reader.result as string);
            setBackCardCorners(fullCorners);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, foto: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, firma: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFingerprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, huella: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpdatePosition = (key: string, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [key]: { x, y } }));
  };

  const handleUpdateCorner = (index: 0 | 1 | 2 | 3, x: number, y: number) => {
    if (activeSide === "front") {
      setFrontCardCorners((prev) => {
        const next: CardCorners = [...prev] as CardCorners;
        next[index] = { x, y };
        return next;
      });
      return;
    }
    setBackCardCorners((prev) => {
      const next: CardCorners = [...prev] as CardCorners;
      next[index] = { x, y };
      return next;
    });
  };

  const handleDownload = () => {
    const stageCanvas = document.querySelector('canvas');
    if (stageCanvas) {
        const link = document.createElement('a');
        link.download = 'credencial-editada.png';
        link.href = stageCanvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 p-8 max-w-7xl mx-auto">
      {/* Editor Form */}
      <div className="w-full lg:w-1/3 bg-gray-50 p-6 rounded-xl shadow-sm overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
             <h2 className="text-2xl font-bold text-gray-800">Editar Datos</h2>
             <div className="flex gap-2">
                 <button
                    onClick={() => setActiveSide(activeSide === 'front' ? 'back' : 'front')}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition"
                 >
                    <RotateCcw size={16}/>
                    {activeSide === 'front' ? 'Ver Reverso' : 'Ver Frente'}
                 </button>
                 <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        isEditing ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-600'
                    }`}
                 >
                    {isEditing ? <Check size={16}/> : <Move size={16}/>}
                    {isEditing ? 'Terminar' : 'Mover'}
                 </button>
             </div>
        </div>
        
        {/* Template Upload */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg">
             <label className="block text-sm font-bold text-blue-800 mb-2 flex items-center gap-2">
                <FileImage size={18} />
                Fondo ({activeSide === 'front' ? 'Frente' : 'Reverso'})
             </label>
             <p className="text-xs text-blue-600 mb-3">
                {activeSide === 'front' 
                    ? "Sube la imagen frontal de la credencial."
                    : "Sube la imagen trasera de la credencial."
                }
             </p>
             <div className="flex items-center gap-2">
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleTemplateUpload}
                    className="hidden"
                    id="template-upload"
                />
                <label htmlFor="template-upload" className="cursor-pointer flex items-center justify-center gap-2 px-4 py-2 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition w-full text-sm font-medium shadow-sm">
                    <Upload size={16} />
                    Cambiar Imagen de Fondo
                </label>
            </div>
        </div>

        {/* Cleaning Tools */}
        <div className="bg-white p-4 rounded-lg border mb-6">
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Paintbrush size={16} />
                    Limpiar Fondo
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        checked={showPatches} 
                        onChange={(e) => setShowPatches(e.target.checked)}
                        className="sr-only peer" 
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
            {showPatches && (
                <div className="flex items-center gap-2 mt-2">
                    <label className="text-xs text-gray-500">Color del Parche:</label>
                    <input 
                        type="color" 
                        value={patchColor}
                        onChange={(e) => setPatchColor(e.target.value)}
                        className="h-8 w-full rounded cursor-pointer"
                    />
                </div>
            )}
        </div>

        <div className="bg-white p-4 rounded-lg border mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Perspectiva</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={usePerspective}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setUsePerspective(enabled);
                  if (!enabled) setIsCalibrating(false);
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsCalibrating((v) => !v)}
              disabled={!usePerspective}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                usePerspective
                  ? isCalibrating
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {isCalibrating ? "Terminar calibración" : "Calibrar esquinas"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeSide === "front") {
                  if (templateImage && templateImage.width === 1280 && templateImage.height === 720) {
                    setFrontCardCorners(refCorners);
                  } else {
                    setFrontCardCorners(fullCorners);
                  }
                } else {
                  setBackCardCorners(fullCorners);
                }
              }}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition"
            >
              Reset
            </button>
          </div>
          {usePerspective && isCalibrating && (
            <div className="text-xs text-gray-500 mt-2">
              Arrastra los 4 puntos azules a las esquinas de la credencial
            </div>
          )}
        </div>
       
        
        <div className="space-y-4">
          {activeSide === 'front' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subir Foto</label>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                        id="photo-upload"
                    />
                    <label htmlFor="photo-upload" className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition w-full justify-center">
                        <Upload size={18} />
                        Seleccionar Foto
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subir Firma</label>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleSignatureUpload}
                        className="hidden"
                        id="signature-upload"
                    />
                    <label htmlFor="signature-upload" className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition w-full justify-center">
                        <Upload size={18} />
                        Seleccionar Firma
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre Completo</label>
                <textarea
                  name="nombre"
                  value={data.nombre}
                  onChange={handleInputChange}
                  rows={2}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Domicilio</label>
                <textarea
                  name="domicilio"
                  value={data.domicilio}
                  onChange={handleInputChange}
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Clave Elector</label>
                    <input
                    type="text"
                    name="claveElector"
                    value={data.claveElector}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">CURP</label>
                    <input
                    type="text"
                    name="curp"
                    value={data.curp}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Año Registro</label>
                    <input
                    type="text"
                    name="anoRegistro"
                    value={data.anoRegistro}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Sección</label>
                    <input
                    type="text"
                    name="seccion"
                    value={data.seccion}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
               <div>
                    <label className="block text-sm font-medium text-gray-700">Vigencia</label>
                    <input
                    type="text"
                    name="vigencia"
                    value={data.vigencia}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Sexo</label>
                    <input
                    type="text"
                    name="sexo"
                    value={data.sexo}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                    />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subir Huella</label>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleFingerprintUpload}
                        className="hidden"
                        id="fingerprint-upload"
                    />
                    <label htmlFor="fingerprint-upload" className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition w-full justify-center">
                        <Upload size={18} />
                        Seleccionar Huella
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">CIC</label>
                <input
                  type="text"
                  name="cic"
                  value={data.cic}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Identificador Ciudadano</label>
                <input
                  type="text"
                  name="identificador"
                  value={data.identificador}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">OCR</label>
                <textarea
                  name="ocr"
                  value={data.ocr}
                  onChange={handleInputChange}
                  rows={2}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border font-mono"
                />
              </div>
            </>
          )}

            <button
                onClick={handleDownload}
                className="w-full mt-6 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-bold"
            >
                <Download size={20} />
                Descargar Credencial ({activeSide === 'front' ? 'Frente' : 'Reverso'})
            </button>
            
            {isEditing && (
                <div className="text-xs text-center text-gray-500 mt-2">
                    Arrastra los elementos en la imagen para ajustarlos
                </div>
            )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 bg-gray-200 rounded-xl flex items-center justify-center p-8 overflow-auto">
        <IneCanvas 
            data={data} 
            templateImage={templateImage} 
            positions={positions}
            isEditing={isEditing}
            onUpdatePosition={handleUpdatePosition}
            isCalibrating={isCalibrating}
            usePerspective={usePerspective}
            cardCorners={displayedCardCorners}
            onUpdateCorner={handleUpdateCorner}
            showPatches={showPatches}
            patchColor={patchColor}
            activeSide={activeSide}
        />
      </div>
    </div>
  );
}
