/**
 * Máscara de fluido en WebGL2.
 *
 * Solver de fluidos incompresibles (stable fluids: splat -> advección ->
 * divergencia -> presión por Jacobi -> resta de gradiente). El canal de tinta
 * resultante recorta una máscara de borde duro que pinta un logotipo.
 *
 * Los parámetros por defecto están tomados de noth.in, incluida la vorticidad
 * en cero: sin confinamiento de vórtices el rastro se arrastra como líquido en
 * vez de enroscarse como humo.
 */

export type AjustesFluido = {
  resolucionSim: number;
  resolucionTinta: number;
  disipacionVelocidad: number;
  disipacionTinta: number;
  iteracionesPresion: number;
  radioSplat: number;
  fuerzaSplat: number;
  /** Multiplica la tinta antes de umbralizarla. */
  tamanoRevelado: number;
  /** Punto medio del umbral. */
  suavidadBorde: number;
  /** Ancho del umbral. Cuanto menor, más duro el corte. */
  anchoBorde: number;
  /** Opacidad del logotipo cuando el fluido no lo ha tocado. */
  fantasma: number;
  /** Cuánto se ve el fluido FUERA de las letras. Alto ensucia el hero. */
  rastro: number;
  colorFondo: [number, number, number];
  colorFantasma: [number, number, number];
  colorPintado: [number, number, number];
};

export const AJUSTES_POR_DEFECTO: AjustesFluido = {
  resolucionSim: 256,
  resolucionTinta: 512,
  disipacionVelocidad: 0.962,
  disipacionTinta: 0.988,
  iteracionesPresion: 20,
  radioSplat: 0.0008,
  fuerzaSplat: 5900,
  tamanoRevelado: 3.9,
  suavidadBorde: 0.5,
  anchoBorde: 0.01,
  fantasma: 0.1,
  rastro: 0.03,
  colorFondo: [0.043, 0.043, 0.043],
  colorFantasma: [0.949, 0.937, 0.909],
  colorPintado: [0.851, 0.949, 0.051],
};

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const CABECERA = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
`;

const F_SPLAT =
  CABECERA +
  `
uniform sampler2D uTarget;
uniform vec3 uValor;
uniform vec2 uPunto;
uniform float uRadio;
uniform float uRelacion;
void main() {
  vec2 p = vUv - uPunto;
  p.x *= uRelacion;
  vec3 inyectado = exp(-dot(p, p) / uRadio) * uValor;
  outColor = vec4(texture(uTarget, vUv).xyz + inyectado, 1.0);
}`;

const F_ADVECCION =
  CABECERA +
  `
uniform sampler2D uVelocidad;
uniform sampler2D uFuente;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDisipacion;
void main() {
  vec2 origen = vUv - uDt * texture(uVelocidad, vUv).xy * uTexel;
  outColor = uDisipacion * texture(uFuente, origen);
  outColor.a = 1.0;
}`;

const F_DIVERGENCIA =
  CABECERA +
  `
uniform sampler2D uVelocidad;
uniform vec2 uTexel;
void main() {
  float izq = texture(uVelocidad, vUv - vec2(uTexel.x, 0.0)).x;
  float der = texture(uVelocidad, vUv + vec2(uTexel.x, 0.0)).x;
  float aba = texture(uVelocidad, vUv - vec2(0.0, uTexel.y)).y;
  float arr = texture(uVelocidad, vUv + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (der - izq + arr - aba), 0.0, 0.0, 1.0);
}`;

const F_PRESION =
  CABECERA +
  `
uniform sampler2D uPresion;
uniform sampler2D uDivergencia;
uniform vec2 uTexel;
void main() {
  float izq = texture(uPresion, vUv - vec2(uTexel.x, 0.0)).x;
  float der = texture(uPresion, vUv + vec2(uTexel.x, 0.0)).x;
  float aba = texture(uPresion, vUv - vec2(0.0, uTexel.y)).x;
  float arr = texture(uPresion, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergencia, vUv).x;
  outColor = vec4((izq + der + aba + arr - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const F_GRADIENTE =
  CABECERA +
  `
uniform sampler2D uPresion;
uniform sampler2D uVelocidad;
uniform vec2 uTexel;
void main() {
  float izq = texture(uPresion, vUv - vec2(uTexel.x, 0.0)).x;
  float der = texture(uPresion, vUv + vec2(uTexel.x, 0.0)).x;
  float aba = texture(uPresion, vUv - vec2(0.0, uTexel.y)).x;
  float arr = texture(uPresion, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocidad, vUv).xy - vec2(der - izq, arr - aba);
  outColor = vec4(vel, 0.0, 1.0);
}`;

/**
 * Mezcla final. El umbral estrecho (anchoBorde ~0.01) es lo que da el corte
 * duro: el logotipo no aparece con degradado, aparece recortado.
 */
const F_MASCARA =
  CABECERA +
  `
uniform sampler2D uTinta;
uniform sampler2D uLogo;
uniform vec3 uFondo;
uniform vec3 uFantasmaColor;
uniform vec3 uPintado;
uniform float uTamanoRevelado;
uniform float uSuavidadBorde;
uniform float uAnchoBorde;
uniform float uFantasma;
uniform float uRastro;
void main() {
  float tinta = texture(uTinta, vUv).x;
  // El canvas 2D del logotipo va de arriba a abajo; WebGL al revés.
  float letra = texture(uLogo, vec2(vUv.x, 1.0 - vUv.y)).a;

  float mascara = smoothstep(uSuavidadBorde, uSuavidadBorde + uAnchoBorde, tinta * uTamanoRevelado);

  vec3 apagado = mix(uFondo, uFantasmaColor, uFantasma);
  vec3 tintaLetra = mix(apagado, uPintado, mascara);

  // Rastro tenue fuera de las letras, para que el puntero deje señal.
  vec3 color = mix(uFondo, mix(uFondo, uFantasmaColor, uRastro), mascara * (1.0 - letra));
  color = mix(color, tintaLetra, letra);

  outColor = vec4(color, 1.0);
}`;

type Programa = {
  programa: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

type Buffer = {
  textura: WebGLTexture;
  fbo: WebGLFramebuffer;
  ancho: number;
  alto: number;
};

type BufferDoble = {
  leer: Buffer;
  escribir: Buffer;
  intercambiar: () => void;
};

function compilar(gl: WebGL2RenderingContext, tipo: number, fuente: string): WebGLShader {
  const shader = gl.createShader(tipo);
  if (!shader) throw new Error("No se pudo crear el shader");
  gl.shaderSource(shader, fuente);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Error compilando shader: " + log);
  }
  return shader;
}

function crearPrograma(gl: WebGL2RenderingContext, fragmento: string): Programa {
  const programa = gl.createProgram();
  if (!programa) throw new Error("No se pudo crear el programa");
  const vs = compilar(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compilar(gl, gl.FRAGMENT_SHADER, fragmento);
  gl.attachShader(programa, vs);
  gl.attachShader(programa, fs);
  gl.bindAttribLocation(programa, 0, "aPos");
  gl.linkProgram(programa);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    throw new Error("Error enlazando programa: " + gl.getProgramInfoLog(programa));
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const total = gl.getProgramParameter(programa, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < total; i++) {
    const info = gl.getActiveUniform(programa, i);
    if (info) uniforms[info.name] = gl.getUniformLocation(programa, info.name);
  }

  return { programa, uniforms };
}

function crearBuffer(gl: WebGL2RenderingContext, ancho: number, alto: number): Buffer {
  const textura = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!textura || !fbo) throw new Error("No se pudo crear el render target");

  gl.bindTexture(gl.TEXTURE_2D, textura);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, ancho, alto, 0, gl.RGBA, gl.HALF_FLOAT, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textura, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Framebuffer incompleto");
  }
  gl.viewport(0, 0, ancho, alto);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return { textura, fbo, ancho, alto };
}

function crearBufferDoble(gl: WebGL2RenderingContext, ancho: number, alto: number): BufferDoble {
  const estado = { leer: crearBuffer(gl, ancho, alto), escribir: crearBuffer(gl, ancho, alto) };
  return {
    get leer() {
      return estado.leer;
    },
    get escribir() {
      return estado.escribir;
    },
    intercambiar() {
      const tmp = estado.leer;
      estado.leer = estado.escribir;
      estado.escribir = tmp;
    },
  };
}

export type MascaraFluido = {
  /** Inyecta un empujón en (x, y) normalizados, con dirección (dx, dy). */
  salpicar: (x: number, y: number, dx: number, dy: number, intensidad?: number) => void;
  /** Sube la textura del logotipo (un canvas 2D ya dibujado). */
  usarLogo: (fuente: TexImageSource) => void;
  redimensionar: () => void;
  destruir: () => void;
};

export function crearMascaraFluido(
  canvas: HTMLCanvasElement,
  ajustesParciales: Partial<AjustesFluido> = {},
): MascaraFluido | null {
  const ajustes = { ...AJUSTES_POR_DEFECTO, ...ajustesParciales };

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  // Sin esto no se puede renderizar a texturas de coma flotante.
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) {
    return null;
  }
  gl.getExtension("OES_texture_float_linear");

  let programas: Record<string, Programa>;
  try {
    programas = {
      splat: crearPrograma(gl, F_SPLAT),
      adveccion: crearPrograma(gl, F_ADVECCION),
      divergencia: crearPrograma(gl, F_DIVERGENCIA),
      presion: crearPrograma(gl, F_PRESION),
      gradiente: crearPrograma(gl, F_GRADIENTE),
      mascara: crearPrograma(gl, F_MASCARA),
    };
  } catch {
    return null;
  }

  // Un triángulo que cubre la pantalla: más barato que un quad.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const sim = ajustes.resolucionSim;
  const tintaRes = ajustes.resolucionTinta;

  const velocidad = crearBufferDoble(gl, sim, sim);
  const presion = crearBufferDoble(gl, sim, sim);
  const tinta = crearBufferDoble(gl, tintaRes, tintaRes);
  const divergencia = crearBuffer(gl, sim, sim);

  const texelSim: [number, number] = [1 / sim, 1 / sim];
  const texelTinta: [number, number] = [1 / tintaRes, 1 / tintaRes];

  const logo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, logo);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  let relacion = 1;
  let destruido = false;

  const dibujar = (destino: Buffer | null) => {
    if (destino) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, destino.fbo);
      gl.viewport(0, 0, destino.ancho, destino.alto);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const usarTextura = (unidad: number, textura: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unidad);
    gl.bindTexture(gl.TEXTURE_2D, textura);
    return unidad;
  };

  function redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ancho = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const alto = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== ancho || canvas.height !== alto) {
      canvas.width = ancho;
      canvas.height = alto;
    }
    relacion = ancho / alto;
  }

  function salpicar(x: number, y: number, dx: number, dy: number, intensidad = 1) {
    if (destruido) return;
    const p = programas.splat;
    gl.useProgram(p.programa);
    gl.uniform1f(p.uniforms.uRelacion ?? null, relacion);
    gl.uniform2f(p.uniforms.uPunto ?? null, x, y);
    gl.uniform1f(p.uniforms.uRadio ?? null, ajustes.radioSplat);

    // Empuje de velocidad.
    gl.uniform1i(p.uniforms.uTarget ?? null, usarTextura(0, velocidad.leer.textura));
    const fuerza = ajustes.fuerzaSplat * intensidad;
    gl.uniform3f(p.uniforms.uValor ?? null, dx * fuerza, dy * fuerza, 0);
    dibujar(velocidad.escribir);
    velocidad.intercambiar();

    // Tinta: es la que luego se umbraliza para recortar el logotipo.
    gl.uniform1i(p.uniforms.uTarget ?? null, usarTextura(0, tinta.leer.textura));
    gl.uniform3f(p.uniforms.uValor ?? null, intensidad, intensidad, intensidad);
    dibujar(tinta.escribir);
    tinta.intercambiar();
  }

  function usarLogo(fuente: TexImageSource) {
    if (destruido) return;
    gl.bindTexture(gl.TEXTURE_2D, logo);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fuente);
  }

  function paso(dt: number) {
    gl.bindVertexArray(vao);

    // 1. Advección de la velocidad sobre sí misma.
    let p = programas.adveccion;
    gl.useProgram(p.programa);
    gl.uniform2f(p.uniforms.uTexel ?? null, texelSim[0], texelSim[1]);
    gl.uniform1f(p.uniforms.uDt ?? null, dt);
    gl.uniform1i(p.uniforms.uVelocidad ?? null, usarTextura(0, velocidad.leer.textura));
    gl.uniform1i(p.uniforms.uFuente ?? null, usarTextura(0, velocidad.leer.textura));
    gl.uniform1f(p.uniforms.uDisipacion ?? null, ajustes.disipacionVelocidad);
    dibujar(velocidad.escribir);
    velocidad.intercambiar();

    // 2. Divergencia del campo de velocidad.
    p = programas.divergencia;
    gl.useProgram(p.programa);
    gl.uniform2f(p.uniforms.uTexel ?? null, texelSim[0], texelSim[1]);
    gl.uniform1i(p.uniforms.uVelocidad ?? null, usarTextura(0, velocidad.leer.textura));
    dibujar(divergencia);

    // 3. Presión por Jacobi.
    p = programas.presion;
    gl.useProgram(p.programa);
    gl.uniform2f(p.uniforms.uTexel ?? null, texelSim[0], texelSim[1]);
    gl.uniform1i(p.uniforms.uDivergencia ?? null, usarTextura(1, divergencia.textura));
    for (let i = 0; i < ajustes.iteracionesPresion; i++) {
      gl.uniform1i(p.uniforms.uPresion ?? null, usarTextura(0, presion.leer.textura));
      dibujar(presion.escribir);
      presion.intercambiar();
    }

    // 4. Resta del gradiente: deja el campo sin divergencia (incompresible).
    p = programas.gradiente;
    gl.useProgram(p.programa);
    gl.uniform2f(p.uniforms.uTexel ?? null, texelSim[0], texelSim[1]);
    gl.uniform1i(p.uniforms.uPresion ?? null, usarTextura(0, presion.leer.textura));
    gl.uniform1i(p.uniforms.uVelocidad ?? null, usarTextura(1, velocidad.leer.textura));
    dibujar(velocidad.escribir);
    velocidad.intercambiar();

    // 5. La tinta viaja con el fluido.
    p = programas.adveccion;
    gl.useProgram(p.programa);
    gl.uniform2f(p.uniforms.uTexel ?? null, texelTinta[0], texelTinta[1]);
    gl.uniform1f(p.uniforms.uDt ?? null, dt);
    gl.uniform1i(p.uniforms.uVelocidad ?? null, usarTextura(0, velocidad.leer.textura));
    gl.uniform1i(p.uniforms.uFuente ?? null, usarTextura(1, tinta.leer.textura));
    gl.uniform1f(p.uniforms.uDisipacion ?? null, ajustes.disipacionTinta);
    dibujar(tinta.escribir);
    tinta.intercambiar();
  }

  function pintar() {
    const p = programas.mascara;
    gl.useProgram(p.programa);
    gl.uniform1i(p.uniforms.uTinta ?? null, usarTextura(0, tinta.leer.textura));
    gl.uniform1i(p.uniforms.uLogo ?? null, usarTextura(1, logo));
    gl.uniform3fv(p.uniforms.uFondo ?? null, ajustes.colorFondo);
    gl.uniform3fv(p.uniforms.uFantasmaColor ?? null, ajustes.colorFantasma);
    gl.uniform3fv(p.uniforms.uPintado ?? null, ajustes.colorPintado);
    gl.uniform1f(p.uniforms.uTamanoRevelado ?? null, ajustes.tamanoRevelado);
    gl.uniform1f(p.uniforms.uSuavidadBorde ?? null, ajustes.suavidadBorde);
    gl.uniform1f(p.uniforms.uAnchoBorde ?? null, ajustes.anchoBorde);
    gl.uniform1f(p.uniforms.uFantasma ?? null, ajustes.fantasma);
    gl.uniform1f(p.uniforms.uRastro ?? null, ajustes.rastro);
    dibujar(null);
  }

  redimensionar();

  let ultimo = performance.now();
  let rafId = 0;
  const bucle = (ahora: number) => {
    if (destruido) return;
    const dt = Math.min((ahora - ultimo) / 1000, 0.033);
    ultimo = ahora;
    paso(dt);
    pintar();
    rafId = requestAnimationFrame(bucle);
  };
  rafId = requestAnimationFrame(bucle);

  return {
    salpicar,
    usarLogo,
    redimensionar,
    destruir() {
      destruido = true;
      cancelAnimationFrame(rafId);
      const perder = gl.getExtension("WEBGL_lose_context");
      perder?.loseContext();
    },
  };
}
