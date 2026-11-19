/**
 * Shaders GLSL ES 1.00 (WebGL 1/2 compatible) pour SG Vision Farmer V3 :
 * 1) Passe Shadow Map RGBA 24-bit
 * 2) Passe Dome Celeste Atmospherique + Nuages FBM + Etoiles
 * 3) Passe Principale PBR-inspiree : ombres PCF 3x3, 12 materiaux proceduraux, ACES & gamma
 */

const PRECISION_HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

export const SHADOW_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uLightVP;
uniform mat4 uModel;
uniform float uTime;
uniform float uWindAmt;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  if (uWindAmt > 0.001) {
    float phase = wp.x * 0.72 + wp.z * 0.61 + uTime * 2.1;
    float factor = uWindAmt * clamp(aPos.y, 0.0, 2.0);
    wp.x += sin(phase) * 0.075 * factor;
    wp.z += cos(phase * 0.85) * 0.045 * factor;
  }
  gl_Position = uLightVP * wp;
}
`;

export const SHADOW_FS = `
${PRECISION_HEADER}
vec4 packDepth(float depth) {
  const vec3 bitShift = vec3(1.0, 255.0, 65025.0);
  const vec3 bitMask = vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  vec3 comp = fract(clamp(depth, 0.0, 0.99998) * bitShift);
  comp -= comp.yzx * bitMask;
  return vec4(comp, 1.0);
}
void main() {
  gl_FragColor = packDepth(gl_FragCoord.z);
}
`;

export const SKY_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uProj;
uniform mat4 uView;
varying vec3 vDir;
void main() {
  vDir = aPos;
  vec3 viewDir = mat3(uView) * aPos;
  vec4 clip = uProj * vec4(viewDir, 1.0);
  gl_Position = clip.xyww;
}
`;

export const SKY_FS = `
${PRECISION_HEADER}
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uSunInt;
uniform float uRain;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.04 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

vec3 acesToneMap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 s = normalize(uSunDir);
  float y = clamp(d.y, -0.2, 1.0);
  float up = clamp(d.y, 0.0, 1.0);

  float golden = clamp(1.0 - abs(s.y - 0.12) * 3.0, 0.0, 1.0) * step(-0.08, s.y);
  float dayAmt = smoothstep(-0.08, 0.25, s.y);

  vec3 nightZenith = vec3(0.012, 0.022, 0.055);
  vec3 nightHorizon = vec3(0.038, 0.06, 0.11);
  vec3 dayZenith = mix(vec3(0.11, 0.34, 0.72), vec3(0.22, 0.27, 0.34), uRain * 0.75);
  vec3 dayHorizon = mix(vec3(0.48, 0.68, 0.88), vec3(0.42, 0.47, 0.52), uRain * 0.7);
  dayHorizon = mix(dayHorizon, vec3(0.95, 0.56, 0.30), golden * 0.62 * (1.0 - uRain * 0.65));

  vec3 zenithCol = mix(nightZenith, dayZenith, dayAmt);
  vec3 horizonCol = mix(nightHorizon, dayHorizon, dayAmt);
  vec3 col = mix(horizonCol, zenithCol, pow(up, 0.52));

  // Halo solaire et disque solaire
  float sunCos = max(dot(d, s), 0.0);
  vec3 sunTint = mix(vec3(1.0, 0.52, 0.22), vec3(1.0, 0.96, 0.86), smoothstep(0.04, 0.45, s.y));
  col += sunTint * pow(sunCos, 9.0) * 0.36 * dayAmt * (1.0 - uRain * 0.75);
  col += sunTint * smoothstep(0.9985, 0.9996, sunCos) * 2.4 * dayAmt * (1.0 - uRain * 0.85);

  // Nuages proceduraux FBM sur le plan celeste
  if (d.y > 0.03) {
    vec2 cloudUv = d.xz / (d.y + 0.16) * 0.85 + vec2(uTime * 0.012, uTime * 0.006);
    float cDensity = fbm4(cloudUv);
    float cov = mix(0.48, 0.26, uRain);
    float cloudMask = smoothstep(cov, cov + 0.28, cDensity) * smoothstep(0.03, 0.22, d.y);
    float edgeLight = fbm4(cloudUv + s.xz * 0.14);
    vec3 cloudLit = mix(vec3(0.18, 0.22, 0.32), mix(vec3(1.0, 0.98, 0.96), vec3(1.0, 0.72, 0.48), golden * 0.65), dayAmt);
    vec3 cloudDark = mix(vec3(0.05, 0.07, 0.12), mix(vec3(0.48, 0.56, 0.66), vec3(0.32, 0.36, 0.42), uRain), dayAmt);
    vec3 cloudCol = mix(cloudDark, cloudLit, clamp(0.55 + (cDensity - edgeLight) * 2.2, 0.0, 1.0));
    col = mix(col, cloudCol, cloudMask * mix(0.75, 0.92, uRain));
  }

  // Etoiles discretes la nuit
  if (dayAmt < 0.35 && d.y > 0.05) {
    vec2 starGrid = floor(d.xz / (d.y + 0.25) * 140.0);
    float st = hash21(starGrid);
    if (st > 0.992) {
      float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + st * 90.0);
      col += vec3(0.85, 0.92, 1.0) * twinkle * (1.0 - dayAmt * 2.8) * (1.0 - uRain * 0.9);
    }
  }

  // Sol sous l'horizon
  if (y < 0.0) {
    col = mix(horizonCol, horizonCol * 0.45, clamp(-y * 4.0, 0.0, 1.0));
  }

  vec3 mapped = pow(acesToneMap(col), vec3(1.0 / 2.2));
  gl_FragColor = vec4(mapped, 1.0);
}
`;

export const MAIN_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uWindAmt;
varying vec3 vNorm;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec4 vLightSpacePos;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  if (uWindAmt > 0.001) {
    float phase = wp.x * 0.72 + wp.z * 0.61 + uTime * 2.1;
    float factor = uWindAmt * clamp(aPos.y, 0.0, 2.0);
    wp.x += sin(phase) * 0.075 * factor;
    wp.z += cos(phase * 0.85) * 0.045 * factor;
  }
  vWorldPos = wp.xyz;
  vLocalPos = aPos;
  vNorm = normalize(uNormalMat * aNorm);
  vLightSpacePos = uLightVP * wp;
  gl_Position = uProj * uView * wp;
}
`;

export const MAIN_FS = `
${PRECISION_HEADER}
varying vec3 vNorm;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec4 vLightSpacePos;

uniform vec3 uEyePos;
uniform vec4 uColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunInt;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform float uEmissive;
uniform float uMatType;
uniform float uTime;
uniform float uRain;
uniform float uShadowsEnabled;
uniform float uShadowTexel;
uniform sampler2D uShadowMap;
uniform float uShowContours;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.12);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p = p * 2.07 + vec2(11.3, 23.9);
    a *= 0.5;
  }
  return v;
}

float unpackDepth(vec4 rgba) {
  const vec3 bitShift = vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0);
  return dot(rgba.rgb, bitShift);
}

float sampleShadow(vec3 n, vec3 sunDir) {
  if (uShadowsEnabled < 0.5) return 1.0;
  vec3 proj = vLightSpacePos.xyz / max(vLightSpacePos.w, 0.0001);
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.02 || proj.x > 0.98 || proj.y < 0.02 || proj.y > 0.98 || proj.z > 0.995) {
    return 1.0;
  }
  float ndotl = clamp(dot(n, sunDir), 0.0, 1.0);
  float bias = max(0.0028 * (1.0 - ndotl), 0.0008);
  float shadow = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 uv = proj.xy + vec2(float(x), float(y)) * uShadowTexel;
      float d = unpackDepth(texture2D(uShadowMap, uv));
      shadow += (proj.z - bias <= d) ? 1.0 : 0.0;
    }
  }
  shadow /= 9.0;
  float edgeDist = max(abs(proj.x - 0.5), abs(proj.y - 0.5));
  float fade = smoothstep(0.49, 0.42, edgeDist);
  return mix(1.0, shadow, fade);
}

vec3 acesToneMap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNorm);
  vec3 sunDir = normalize(uSunDir);
  vec3 viewDir = normalize(uEyePos - vWorldPos);
  vec3 baseCol = uColor.rgb;

  float roughness = 0.65;
  float specWeight = 0.12;
  float fresnelAmt = 0.0;
  float sssAmt = 0.0;
  float ao = 1.0;

  float m = floor(uMatType + 0.5);

  if (m > 0.5 && m < 1.5) {
    // 1 = Terrain agricole & paysage FBM
    float macro = fbm3(vWorldPos.xz * 0.075);
    float micro = fbm3(vWorldPos.xz * 0.55);
    float detail = noise2(vWorldPos.xz * 2.8);
    vec3 lushGrass = baseCol * vec3(0.86, 1.04, 0.78);
    vec3 sunMeadow = baseCol * vec3(1.18, 1.12, 0.72);
    vec3 meadowCol = mix(lushGrass, sunMeadow, smoothstep(0.28, 0.72, macro));
    meadowCol *= 0.88 + 0.22 * micro + (detail - 0.5) * 0.08;

    // Herbe plus dense en fond de vallee humide
    float valley = smoothstep(0.35, -0.35, vWorldPos.y);
    meadowCol = mix(meadowCol, meadowCol * vec3(0.76, 0.94, 0.72), valley * 0.55);

    // Pentes rocheuses / terre calcaire sur talus
    float slope = 1.0 - clamp(n.y, 0.0, 1.0);
    vec3 limestoneEarth = mix(vec3(0.48, 0.41, 0.31), vec3(0.36, 0.31, 0.24), micro);
    baseCol = mix(meadowCol, limestoneEarth, smoothstep(0.08, 0.34, slope));

    // Fleurs sauvages subtiles au loin et sur prairies
    if (detail > 0.86 && slope < 0.09) {
      baseCol = mix(baseCol, vec3(0.88, 0.85, 0.52), 0.18);
    }

    // Courbes topographiques affichees uniquement en mode sculpture
    if (uShowContours > 0.5) {
      float contour = abs(fract(vWorldPos.y * 1.25) - 0.5);
      if (contour < 0.045) {
        baseCol = mix(baseCol, vec3(0.95, 0.75, 0.25), 0.55);
      }
    }
    roughness = mix(0.85, 0.35, uRain * 0.65);
    specWeight = mix(0.06, 0.28, uRain * 0.7);
  } else if (m > 1.5 && m < 2.5) {
    // 2 = Eau animee Fresnel (riviere & mare)
    vec2 uv1 = vWorldPos.xz * 1.35 + vec2(uTime * 0.55, uTime * 0.22);
    vec2 uv2 = vWorldPos.xz * 2.6 - vec2(uTime * 0.38, -uTime * 0.46);
    float w1 = noise2(uv1) - 0.5;
    float w2 = noise2(uv2) - 0.5;
    n = normalize(n + vec3(w1 * 0.18 + w2 * 0.12, 0.0, w2 * 0.18 - w1 * 0.12));

    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
    vec3 deepWater = baseCol * vec3(0.32, 0.58, 0.68);
    vec3 skyReflect = mix(uSkyColor, uHorizonColor, 0.45);
    float currentStreak = smoothstep(0.62, 0.85, noise2(vWorldPos.xz * vec2(0.8, 3.4) + vec2(-uTime * 0.9, 0.0)));
    baseCol = mix(deepWater, skyReflect, clamp(fresnel * 0.82 + 0.12, 0.0, 0.92));
    baseCol = mix(baseCol, vec3(0.82, 0.92, 0.96), currentStreak * 0.22);
    roughness = 0.06;
    specWeight = 0.95;
    fresnelAmt = fresnel * 0.35;
  } else if (m > 2.5 && m < 3.5) {
    // 3 = Pierre de taille calcaire & mortier
    vec2 stUv = vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y * 2.4);
    float rowIdx = floor(stUv.y * 1.7);
    float colCoord = stUv.x * 1.15 + mod(rowIdx, 2.0) * 0.5;
    vec2 cell = vec2(floor(colCoord), rowIdx);
    vec2 f = vec2(fract(colCoord), fract(stUv.y * 1.7));
    float stoneVar = hash21(cell);
    float mortar = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) *
                   smoothstep(0.0, 0.08, f.y) * smoothstep(1.0, 0.92, f.y);
    float grain = fbm3(vWorldPos.xz * 3.0 + vWorldPos.y * 2.0);
    vec3 stoneCol = baseCol * (0.86 + 0.24 * stoneVar) * (0.9 + 0.18 * grain);
    vec3 mortarCol = baseCol * 0.55;
    baseCol = mix(mortarCol, stoneCol, mortar);
    ao *= 0.82 + 0.18 * smoothstep(0.0, 0.35, vLocalPos.y);
    roughness = 0.82;
    specWeight = 0.08;
  } else if (m > 3.5 && m < 4.5) {
    // 4 = Tuiles canal terre cuite
    vec2 tileUv = vec2((vWorldPos.x + vWorldPos.z * 0.25) * 4.5, (vWorldPos.z + vWorldPos.x * 0.25) * 3.2);
    float wave = sin(tileUv.x * 6.2831);
    float row = fract(tileUv.y);
    float tileId = hash21(vec2(floor(tileUv.x), floor(tileUv.y)));
    baseCol *= (0.84 + 0.28 * tileId) * (0.88 + 0.12 * wave);
    if (row < 0.12) baseCol *= 0.72;
    // Mousse discrete sur quelques tuiles
    if (tileId > 0.88) baseCol = mix(baseCol, vec3(0.28, 0.38, 0.18), 0.35);
    roughness = 0.68;
    specWeight = 0.14;
  } else if (m > 4.5 && m < 5.5) {
    // 5 = Feuillage & cultures (texture foliaire fine + translucidite SSS au soleil)
    float leafN = fbm3(vWorldPos.xz * 3.4 + vWorldPos.y * 2.5);
    float leafDapple = noise2(vWorldPos.xz * 9.0 + vWorldPos.y * 6.5);
    baseCol *= (0.8 + 0.34 * leafN) * (0.9 + 0.2 * leafDapple);
    sssAmt = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 3.0) * 0.44;
    ao *= 0.78 + 0.22 * smoothstep(0.0, 0.45, vLocalPos.y);
    roughness = 0.62;
    specWeight = 0.1;
  } else if (m > 5.5 && m < 6.5) {
    // 6 = Verre serre & panneau photovoltaique
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.5);
    // Panneau solaire si dominante bleue foncee
    if (baseCol.b > baseCol.r * 1.8 && baseCol.b < 0.65) {
      float gx = smoothstep(0.02, 0.06, fract(vWorldPos.x * 2.4));
      float gz = smoothstep(0.02, 0.06, fract(vWorldPos.z * 2.4));
      baseCol *= 0.75 + 0.25 * gx * gz;
      baseCol = mix(baseCol, uSkyColor * 0.85, fresnel * 0.45);
      roughness = 0.14;
      specWeight = 0.78;
    } else {
      baseCol = mix(baseCol, uSkyColor * 1.15, fresnel * 0.58);
      roughness = 0.08;
      specWeight = 0.9;
    }
  } else if (m > 6.5 && m < 7.5) {
    // 7 = Terre travaillee / billons maraichers
    float furrow = sin((vWorldPos.z * 11.0) + noise2(vWorldPos.xz * 2.0) * 1.2) * 0.5 + 0.5;
    float clods = fbm3(vWorldPos.xz * 6.5);
    baseCol *= (0.78 + 0.24 * furrow) * (0.85 + 0.26 * clods);
    float wet = smoothstep(0.45, 0.22, dot(uColor.rgb, vec3(0.33))) + uRain * 0.5;
    roughness = mix(0.88, 0.36, clamp(wet, 0.0, 1.0));
    specWeight = mix(0.06, 0.28, clamp(wet, 0.0, 1.0));
  } else if (m > 7.5 && m < 8.5) {
    // 8 = Bois de charpente & clotures
    float grain = fbm3(vec2(vWorldPos.x * 2.0 + vWorldPos.z * 2.0, vWorldPos.y * 12.0));
    float plank = smoothstep(0.0, 0.06, fract((vWorldPos.x + vWorldPos.z) * 3.0));
    baseCol *= (0.82 + 0.3 * grain) * (0.85 + 0.15 * plank);
    roughness = 0.78;
    specWeight = 0.08;
  } else if (m > 8.5 && m < 9.5) {
    // 9 = Chemin calcaire / cour gravillonnee
    float pebble = noise2(vWorldPos.xz * 9.5);
    float patchN = fbm3(vWorldPos.xz * 0.9);
    baseCol *= (0.86 + 0.22 * pebble) * (0.9 + 0.18 * patchN);
    roughness = 0.9;
    specWeight = 0.05;
  } else if (m > 9.5 && m < 10.5) {
    // 10 = Metal galvanise / tole ondulee
    float corr = sin((vWorldPos.x + vWorldPos.z) * 18.0) * 0.06;
    float brushed = noise2(vWorldPos.xz * 5.0 + vWorldPos.y * 4.0) * 0.08;
    baseCol += vec3(corr + brushed - 0.03);
    roughness = 0.32;
    specWeight = 0.55;
  } else if (m > 10.5) {
    // 11 = Laine / pelage / plumage animal
    float coat = fbm3(vWorldPos.xz * 8.0 + vWorldPos.y * 8.0);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
    baseCol *= 0.88 + 0.22 * coat;
    baseCol += baseCol * rim * 0.18;
    roughness = 0.86;
    specWeight = 0.06;
  } else {
    // 0 = Matiere peinte standard
    ao *= 0.88 + 0.12 * smoothstep(0.0, 0.25, vLocalPos.y);
  }

  float shadow = sampleShadow(n, sunDir);
  float wrapDiff = max((dot(n, sunDir) + 0.15) / 1.15, 0.0);
  float rawDiff = max(dot(n, sunDir), 0.0);
  float diff = mix(rawDiff, wrapDiff, m > 4.5 && m < 5.5 ? 0.5 : 0.15);

  vec3 halfVec = normalize(sunDir + viewDir);
  float shininess = mix(96.0, 8.0, clamp(roughness, 0.04, 1.0));
  float spec = pow(max(dot(n, halfVec), 0.0), shininess) * specWeight * shadow * uSunInt;

  float hemi = 0.5 + 0.5 * n.y;
  vec3 groundBounce = mix(vec3(0.08, 0.09, 0.06), vec3(0.22, 0.24, 0.17), uSunInt);
  vec3 skyAmb = mix(vec3(0.05, 0.07, 0.12), uSkyColor * 0.72, max(uSunInt, 0.15));
  vec3 amb = mix(groundBounce, skyAmb, hemi) * ao;

  vec3 sunLight = uSunColor * (diff * uSunInt * 1.18 * shadow);
  vec3 sssLight = uSunColor * (sssAmt * uSunInt * (0.45 + 0.55 * shadow));
  vec3 lit = baseCol * (amb + sunLight + sssLight) + baseCol * uEmissive + uSunColor * spec + skyAmb * fresnelAmt;

  // Perspective aerienne & brume d'horizon exponentielle
  float camDist = length(uEyePos - vWorldPos);
  float fogFactor = 1.0 - exp(-pow(max(0.0, camDist - 56.0) * 0.0068, 2.0));
  fogFactor = clamp(fogFactor, 0.0, 0.88);
  float sunAlign = pow(max(dot(normalize(vWorldPos - uEyePos), sunDir), 0.0), 4.0);
  vec3 fogCol = mix(uHorizonColor, uSunColor * 0.85, sunAlign * 0.22 * uSunInt);
  vec3 finalRgb = mix(lit, fogCol, fogFactor);

  vec3 mapped = pow(acesToneMap(finalRgb), vec3(1.0 / 2.2));
  gl_FragColor = vec4(mapped, uColor.a);
}
`;

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "Unknown shader error";
    gl.deleteShader(sh);
    throw new Error(`[WebGL Shader Error: ${label}] ${log}`);
  }
  return sh;
}

export function createShaderProgram(gl, vsSrc, fsSrc, label = "program") {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vs`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.fs`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "Unknown link error";
    gl.deleteProgram(prog);
    throw new Error(`[WebGL Link Error: ${label}] ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}
