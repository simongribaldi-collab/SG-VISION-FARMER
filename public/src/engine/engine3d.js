import * as THREE from "../../vendor/three/three.module.min.js";
import { GLTFLoader } from "../../vendor/three/loaders/GLTFLoader.js";
import { Sky } from "../../vendor/three/objects/Sky.js";
import { BUILDING_CATALOG, generateTerrainHeights } from "../data/presets.js";
import { createPbrMaterials } from "./texturesPbr.js";
import {
  buildAnimalMeshPbr,
  buildCadastralParcelsPbr,
  buildInstancedGrassPbr,
  buildPerimeterTreesPbr,
  buildPlotsAndCropsPbr,
  buildRiverPbr,
  buildRobotMeshPbr,
  buildStructuresPbr,
  buildTerrainMeshPbr,
  createSharedGeometries,
  disposeSharedGeometries,
} from "./sceneBuildersPbr.js";
import { computeSunPosition } from "./weather.js";

/**
 * Interpole la hauteur du terrain (denivele) en tout point (x, z) du monde 3D.
 */
export function getTerrainHeight(state, worldX, worldZ) {
  const t = state?.terrain;
  if (!t || !Array.isArray(t.heights) || !t.res) return 0;
  const gSize = (state.farm?.gridSize || 44) + 8;
  const res = t.res;
  const fx = ((worldX / gSize) + 0.5) * res;
  const fz = ((worldZ / gSize) + 0.5) * res;
  const x0 = Math.max(0, Math.min(res - 1, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(res - 1, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const tz = Math.max(0, Math.min(1, fz - z0));

  const stride = res + 1;
  const h00 = t.heights[z0 * stride + x0] || 0;
  const h10 = t.heights[z0 * stride + x0 + 1] || 0;
  const h01 = t.heights[(z0 + 1) * stride + x0] || 0;
  const h11 = t.heights[(z0 + 1) * stride + x0 + 1] || 0;

  return (
    h00 * (1 - tx) * (1 - tz) +
    h10 * tx * (1 - tz) +
    h01 * (1 - tx) * tz +
    h11 * tx * tz
  );
}

/**
 * Modifie le denivele au pinceau 3D (raise, lower, flatten, smooth).
 */
export function sculptTerrainAt(state, worldX, worldZ, tool = "raise", radius = 4.5, strength = 0.28) {
  if (!state.terrain || !Array.isArray(state.terrain.heights)) {
    state.terrain = generateTerrainHeights("valley_river", 32);
  }
  const t = state.terrain;
  const res = t.res;
  const stride = res + 1;
  const gSize = (state.farm?.gridSize || 44) + 8;
  const centerH = getTerrainHeight(state, worldX, worldZ);

  for (let gz = 0; gz <= res; gz++) {
    for (let gx = 0; gx <= res; gx++) {
      const vx = ((gx / res) - 0.5) * gSize;
      const vz = ((gz / res) - 0.5) * gSize;
      const dist = Math.hypot(vx - worldX, vz - worldZ);
      if (dist > radius) continue;

      const falloff = Math.cos((dist / radius) * (Math.PI / 2));
      const idx = gz * stride + gx;
      const cur = t.heights[idx] || 0;

      if (tool === "raise") {
        t.heights[idx] = Number(Math.min(6.5, cur + strength * falloff).toFixed(2));
      } else if (tool === "lower") {
        t.heights[idx] = Number(Math.max(-3.0, cur - strength * falloff).toFixed(2));
      } else if (tool === "flatten") {
        t.heights[idx] = Number((cur + (centerH - cur) * 0.35 * falloff).toFixed(2));
      } else if (tool === "smooth") {
        let sum = cur, cnt = 1;
        if (gx > 0) { sum += t.heights[idx - 1]; cnt++; }
        if (gx < res) { sum += t.heights[idx + 1]; cnt++; }
        if (gz > 0) { sum += t.heights[idx - stride]; cnt++; }
        if (gz < res) { sum += t.heights[idx + stride]; cnt++; }
        const avg = sum / cnt;
        t.heights[idx] = Number((cur + (avg - cur) * 0.5 * falloff).toFixed(2));
      }
    }
  }
  t._dirty = true;
  t._version = (t._version || 0) + 1;
}

export class Farm3DEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.camera = { yaw: 0.62, pitch: 0.41, dist: 39, targetX: 0, targetZ: -1.0 };
    this.overlay = "normal";
    this.selectedId = null;
    this.buildMode = { active: false, type: "bed_open", rot: 0, hoverX: 0, hoverZ: 0, hoverValid: false };
    this.sculptMode = { active: false, tool: "raise", radius: 5.0 };
    this.shadowsEnabled = true;
    this.shadowSupported = false;
    this.shadowSize = 2048;

    this.elapsed = 0;
    this.hitBoxes = [];
    this.arPins = [];
    this.lastState = null;

    this.dragging = false;
    this.dragButton = 0;
    this.dragMoved = false;
    this.lastMouse = { x: 0, y: 0 };
    this._didSculpt = false;

    this.glbCache = new Map();
    this.glbLoading = new Set();
    this._terrainSig = "";
    this._grassSig = "";
    this._cadastralSig = "";
    this._staticSig = "";
    this._livestockSig = "";
    this._robotSig = "";
    this._envBucket = "";
    this.envTarget = null;
    this.animItems = [];
    this.animalAgents = [];
    this.robotAgents = [];
    this.staticHitBoxes = [];
    this.staticArPinDescs = [];
    this.cadastralPinDescs = [];

    this._initThree();
    this._bindEvents();
  }

  _initThree() {
    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch {
      this.renderer = null;
      this.gl = null;
      return;
    }

    this.renderer = renderer;
    this.gl = renderer.getContext();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.shadowSupported = Boolean(renderer.shadowMap.enabled && this.gl);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc2e3);
    this.scene.fog = new THREE.FogExp2(0xc4d8eb, 0.0036);
    this.scene.environmentIntensity = 0.55;

    this.threeCamera = new THREE.PerspectiveCamera(44, 1.6, 0.4, 340);

    // Ciel physique Preetham + PMREM HDRI
    const tintSkyShader = (skyObj) => {
      skyObj.material.fragmentShader = skyObj.material.fragmentShader.replace(
        "gl_FragColor = vec4( retColor, 1.0 );",
        "gl_FragColor = vec4( clamp(pow(retColor, vec3(2.0)) * vec3(0.62, 0.76, 1.0), 0.0, 1.0), 1.0 );"
      );
      skyObj.material.needsUpdate = true;
    };
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    tintSkyShader(this.sky);
    const skyUni = this.sky.material.uniforms;
    skyUni.turbidity.value = 3.2;
    skyUni.rayleigh.value = 2.0;
    skyUni.mieCoefficient.value = 0.003;
    skyUni.mieDirectionalG.value = 0.82;
    this.scene.add(this.sky);

    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(10);
    tintSkyShader(this.envSky);
    this.envScene.add(this.envSky);
    try {
      this.pmremGenerator = new THREE.PMREMGenerator(renderer);
      this.pmremGenerator.compileEquirectangularShader();
    } catch {
      this.pmremGenerator = null;
    }

    // Dôme étoilé nocturne
    const starPos = [];
    for (let i = 0; i < 420; i++) {
      const th = (i * 2.39996) % (Math.PI * 2);
      const ph = Math.acos(0.15 + ((i * 37) % 85) / 100);
      const r = 195;
      starPos.push(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xf8fafc, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0 });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    // Eclairage 3 points + Soleil 2048x2048
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.75);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 145;
    this.sunLight.shadow.camera.left = -33;
    this.sunLight.shadow.camera.right = 33;
    this.sunLight.shadow.camera.top = 33;
    this.sunLight.shadow.camera.bottom = -33;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xa3c9f2, 0x3b4d2b, 0.72);
    this.scene.add(this.hemiLight);

    this.fillLight = new THREE.DirectionalLight(0xbad4f5, 0.36);
    this.fillLight.position.set(-22, 24, -18);
    this.scene.add(this.fillLight);

    // Ressources partagees PBR
    this.geos = createSharedGeometries();
    this.sharedGeoSet = new Set(Object.values(this.geos));
    this.mats = createPbrMaterials(renderer);
    this.gltfLoader = new GLTFLoader();

    // Conteneurs de scene reactifs
    this.terrainGroup = new THREE.Group();
    this.grassGroup = new THREE.Group();
    this.cadastralGroup = new THREE.Group();
    this.staticGroup = new THREE.Group();
    this.livestockGroup = new THREE.Group();
    this.robotGroup = new THREE.Group();
    this.rainGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.scene.add(
      this.terrainGroup,
      this.grassGroup,
      this.cadastralGroup,
      this.staticGroup,
      this.livestockGroup,
      this.robotGroup,
      this.rainGroup,
      this.ghostGroup
    );

    // Maillage fantome construction/sculpture + gouttes de pluie reutilisables
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x33f28c, emissive: 0x16a34a, emissiveIntensity: 0.45, transparent: true, opacity: 0.46, depthWrite: false });
    this.ghostBox = new THREE.Mesh(this.geos.box, this.ghostMat);
    this.ghostCyl = new THREE.Mesh(this.geos.cyl, this.ghostMat);
    this.ghostBox.visible = false;
    this.ghostCyl.visible = false;
    this.ghostGroup.add(this.ghostBox, this.ghostCyl);

    const dropGeo = new THREE.BoxGeometry(0.035, 0.6, 0.035);
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.55 });
    this.rainGeo = dropGeo;
    this.rainMat = dropMat;
    this.rainDrops = [];
    for (let i = 0; i < 85; i++) {
      const dm = new THREE.Mesh(dropGeo, dropMat);
      this.rainDrops.push(dm);
      this.rainGroup.add(dm);
    }
    this.rainGroup.visible = false;
  }

  _disposeGroupGeometries(group) {
    while (group.children.length > 0) {
      const ch = group.children[0];
      group.remove(ch);
      ch.traverse((obj) => {
        if (obj.geometry && !this.sharedGeoSet.has(obj.geometry)) {
          obj.geometry.dispose();
        }
        if (obj.isInstancedMesh) {
          obj.dispose?.();
        }
      });
    }
  }

  loadGlbModel(url) {
    if (!url || this.glbCache.has(url) || this.glbLoading.has(url)) return;
    this.glbLoading.add(url);
    this.gltfLoader.load(
      url,
      (gltf) => {
        this.glbLoading.delete(url);
        const model = gltf.scene || new THREE.Group();
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxXZ = Math.max(0.01, size.x, size.z);
        const normScale = 3.5 / maxXZ;

        const wrap = new THREE.Group();
        model.position.set(-center.x * normScale, -box.min.y * normScale, -center.z * normScale);
        model.scale.multiplyScalar(normScale);
        wrap.add(model);
        this.glbCache.set(url, wrap);
        this._staticSig = "";
      },
      undefined,
      () => {
        this.glbLoading.delete(url);
      }
    );
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.dragButton = e.button;
      this.dragMoved = false;
      this._didSculpt = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (e.button === 0 && this.sculptMode.active && this.callbacks.onSculptTerrain) {
        const rect = c.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.callbacks.onSculptTerrain(hit[0], hit[2]);
          this._didSculpt = true;
        }
      }
    });

    this._onMouseUp = () => {
      this.dragging = false;
      if (this._didSculpt) {
        this._didSculpt = false;
        this.callbacks.onSculptEnd?.();
      }
    };

    this._onMouseMove = (e) => {
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (this.buildMode.active || this.sculptMode.active) {
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.buildMode.hoverX = Math.round(hit[0] * 2) / 2;
          this.buildMode.hoverZ = Math.round(hit[2] * 2) / 2;
          this.buildMode.hoverValid = true;
          if (this.dragging && this.dragButton === 0 && this.sculptMode.active && this.callbacks.onSculptTerrain) {
            this.callbacks.onSculptTerrain(hit[0], hit[2]);
            this._didSculpt = true;
            return;
          }
        }
      }

      if (!this.dragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (this.dragButton === 2 || e.shiftKey) {
        const scale = this.camera.dist * 0.0018;
        const cosY = Math.cos(this.camera.yaw);
        const sinY = Math.sin(this.camera.yaw);
        this.camera.targetX = Math.max(-28, Math.min(28, this.camera.targetX - (dx * cosY + dy * sinY) * scale));
        this.camera.targetZ = Math.max(-28, Math.min(28, this.camera.targetZ - (-dx * sinY + dy * cosY) * scale));
      } else if (!this.sculptMode.active) {
        this.camera.yaw -= dx * 0.0075;
        this.camera.pitch = Math.max(0.12, Math.min(1.42, this.camera.pitch + dy * 0.0065));
      }
    };

    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.dist = Math.max(7, Math.min(105, this.camera.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });

    c.addEventListener("click", (e) => {
      if (this.dragMoved || this.sculptMode.active) return;
      const rect = c.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (this.buildMode.active && this.callbacks.onPlaceBuilding) {
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.callbacks.onPlaceBuilding({
            type: this.buildMode.type,
            x: Math.round(hit[0] * 2) / 2,
            z: Math.round(hit[2] * 2) / 2,
            rot: this.buildMode.rot,
          });
        }
        return;
      }

      const picked = this._pickObject(nx, ny);
      this.selectedId = picked ? picked.id : null;
      if (this.callbacks.onSelect) {
        this.callbacks.onSelect(picked);
      }
    });
  }

  destroy() {
    if (this._onMouseUp) window.removeEventListener("mouseup", this._onMouseUp);
    if (this._onMouseMove) window.removeEventListener("mousemove", this._onMouseMove);
    if (this.renderer) {
      this._disposeGroupGeometries(this.terrainGroup);
      this._disposeGroupGeometries(this.grassGroup);
      this._disposeGroupGeometries(this.cadastralGroup);
      this._disposeGroupGeometries(this.staticGroup);
      this._disposeGroupGeometries(this.livestockGroup);
      this._disposeGroupGeometries(this.robotGroup);
      this.sky?.geometry?.dispose();
      this.sky?.material?.dispose();
      this.envSky?.geometry?.dispose();
      this.envSky?.material?.dispose();
      this.stars?.geometry?.dispose();
      this.starMat?.dispose();
      this.ghostMat?.dispose();
      this.rainGeo?.dispose();
      this.rainMat?.dispose();
      this.envTarget?.dispose();
      this.pmremGenerator?.dispose();
      disposeSharedGeometries(this.geos);
      this.mats?.dispose();
      this.renderer.dispose();
    }
  }

  setCameraPreset(preset) {
    if (preset === "iso") {
      this.camera = { yaw: 0.62, pitch: 0.41, dist: 39, targetX: 0, targetZ: -1.0 };
    } else if (preset === "top") {
      this.camera = { yaw: 0.01, pitch: 1.38, dist: 50, targetX: 0, targetZ: 0 };
    } else if (preset === "ar") {
      this.camera = { yaw: 0.35, pitch: 0.21, dist: 19, targetX: -2, targetZ: -1 };
    } else if (preset === "farmhouse") {
      this.camera = { yaw: 0.38, pitch: 0.42, dist: 21, targetX: -1.5, targetZ: -11.5 };
    }
  }

  _syncThreeCamera(aspect) {
    const { yaw, pitch, dist, targetX, targetZ } = this.camera;
    const baseH = this.lastState ? getTerrainHeight(this.lastState, targetX, targetZ) : 0;
    const eyeX = targetX + Math.sin(yaw) * Math.cos(pitch) * dist;
    const eyeY = baseH + Math.sin(pitch) * dist;
    const eyeZ = targetZ + Math.cos(yaw) * Math.cos(pitch) * dist;

    this.threeCamera.aspect = Math.max(0.1, aspect);
    this.threeCamera.position.set(eyeX, eyeY, eyeZ);
    this.threeCamera.lookAt(targetX, baseH + 0.9, targetZ);
    this.threeCamera.updateMatrixWorld(true);
    this.threeCamera.updateProjectionMatrix();
  }

  _screenRay(nx, ny) {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = (rect.width || this.canvas.width || 800) / (rect.height || this.canvas.height || 500);
    this._syncThreeCamera(aspect);
    const farPt = new THREE.Vector3(nx, ny, 0.5).unproject(this.threeCamera);
    const origin = this.threeCamera.position;
    const dir = farPt.sub(origin).normalize();
    return { origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] };
  }

  _rayToGround(nx, ny) {
    const ray = this._screenRay(nx, ny);
    if (!ray) return null;
    if (!this.lastState?.terrain?.heights) {
      if (Math.abs(ray.dir[1]) < 1e-4) return null;
      const t = -ray.origin[1] / ray.dir[1];
      if (t < 0) return null;
      return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
    }

    let tPrev = 0.5;
    for (let i = 1; i <= 60; i++) {
      const t = i * 2.5;
      const px = ray.origin[0] + ray.dir[0] * t;
      const py = ray.origin[1] + ray.dir[1] * t;
      const pz = ray.origin[2] + ray.dir[2] * t;
      const h = getTerrainHeight(this.lastState, px, pz);
      if (py <= h) {
        let lo = tPrev, hi = t;
        for (let b = 0; b < 6; b++) {
          const mid = (lo + hi) * 0.5;
          const mx = ray.origin[0] + ray.dir[0] * mid;
          const my = ray.origin[1] + ray.dir[1] * mid;
          const mz = ray.origin[2] + ray.dir[2] * mid;
          if (my <= getTerrainHeight(this.lastState, mx, mz)) hi = mid;
          else lo = mid;
        }
        const tf = (lo + hi) * 0.5;
        const fx = ray.origin[0] + ray.dir[0] * tf;
        const fz = ray.origin[2] + ray.dir[2] * tf;
        return [fx, getTerrainHeight(this.lastState, fx, fz), fz];
      }
      tPrev = t;
    }

    if (Math.abs(ray.dir[1]) > 1e-4) {
      const t = -ray.origin[1] / ray.dir[1];
      if (t > 0) return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
    }
    return null;
  }

  _pickObject(nx, ny) {
    const ray = this._screenRay(nx, ny);
    if (!ray) return null;
    let best = null;
    let bestDist = Infinity;

    for (const box of this.hitBoxes) {
      const min = [box.x - box.w / 2, box.y0, box.z - box.d / 2];
      const max = [box.x + box.w / 2, box.y1, box.z + box.d / 2];
      let tmin = -Infinity, tmax = Infinity;
      for (let i = 0; i < 3; i++) {
        const invD = 1 / (Math.abs(ray.dir[i]) < 1e-6 ? 1e-6 : ray.dir[i]);
        let t0 = (min[i] - ray.origin[i]) * invD;
        let t1 = (max[i] - ray.origin[i]) * invD;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
      }
      if (tmax >= Math.max(0, tmin) && tmin < bestDist) {
        bestDist = tmin;
        best = box;
      }
    }
    return best;
  }

  _projectPoint(x, y, z, w, h) {
    const v = new THREE.Vector3(x, y, z).project(this.threeCamera);
    if (v.z < -1 || v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
    };
  }

  _updateAtmosphere(state, sun) {
    const rainMm = state.weather?.current?.rainMm || 0;
    const isRain = rainMm > 0.5;
    const elRad = ((sun.elevationDeg ?? 25) * Math.PI) / 180;
    const el = Math.max(-0.25, Math.min(1, Math.sin(elRad)));
    const xzLen = Math.hypot(sun.x, sun.z) || 1;
    const hScale = Math.sqrt(Math.max(0.01, 1 - el * el));
    const dirX = (sun.x / xzLen) * hScale;
    const dirZ = (sun.z / xzLen) * hScale;
    const skyPos = new THREE.Vector3(dirX * 100, el * 100, dirZ * 100);
    const dusk = el > -0.05 && el < 0.25 ? 1 - Math.abs(el - 0.1) / 0.16 : 0;

    // Mise a jour ciel Preetham
    const skyUni = this.sky.material.uniforms;
    skyUni.sunPosition.value.copy(el < -0.04 ? new THREE.Vector3(skyPos.x, -4, skyPos.z) : skyPos);
    skyUni.turbidity.value = isRain ? 9.0 : dusk > 0.1 ? 6.5 : 2.2;
    skyUni.rayleigh.value = sun.isDay ? (isRain ? 0.6 : 2.2 + dusk * 1.2) : 0.15;
    skyUni.mieCoefficient.value = 0.003;
    this.sky.visible = el > -0.14;

    const envUni = this.envSky.material.uniforms;
    envUni.sunPosition.value.copy(skyUni.sunPosition.value);
    envUni.turbidity.value = skyUni.turbidity.value;
    envUni.rayleigh.value = skyUni.rayleigh.value;
    envUni.mieCoefficient.value = skyUni.mieCoefficient.value;

    const bucket = `${Math.round((state.simulation.hourOfDay || 10.5) * 2)}|${isRain ? 1 : 0}`;
    if (bucket !== this._envBucket && this.pmremGenerator) {
      this._envBucket = bucket;
      try {
        const nextEnv = this.pmremGenerator.fromScene(this.envScene, 0.04);
        this.envTarget?.dispose();
        this.envTarget = nextEnv;
        this.scene.environment = nextEnv.texture;
      } catch {}
    }

    // Lumieres & brouillard synchronises
    const sunLen = Math.hypot(sun.x, sun.y, sun.z) || 1;
    this.sunLight.castShadow = this.shadowsEnabled !== false && sun.isDay;
    this.renderer.shadowMap.enabled = this.shadowsEnabled !== false;
    this.sunLight.position.set((sun.x / sunLen) * 62, Math.max(8, (sun.y / sunLen) * 62), (sun.z / sunLen) * 62);

    if (sun.isDay) {
      this.sunLight.color.setRGB(1.0, 0.9 + el * 0.08, 0.74 + el * 0.22);
      this.sunLight.intensity = isRain ? 1.3 : 2.2 + el * 0.9;
      this.hemiLight.color.setHex(isRain ? 0x8ea4bd : 0x8fc0f2);
      this.hemiLight.groundColor.setHex(0x2f4022);
      this.hemiLight.intensity = isRain ? 0.65 : 0.55;
      this.fillLight.intensity = 0.3;
      this.renderer.toneMappingExposure = isRain ? 0.78 : 0.82;
    } else {
      this.sunLight.color.setHex(0x6e8ec4);
      this.sunLight.intensity = 0.4;
      this.hemiLight.color.setHex(0x283f6b);
      this.hemiLight.groundColor.setHex(0x162218);
      this.hemiLight.intensity = 0.42;
      this.fillLight.intensity = 0.15;
      this.renderer.toneMappingExposure = 0.8;
    }

    const fogHex = !sun.isDay ? 0x0b1326 : isRain ? 0x7b8ea3 : dusk > 0.25 ? 0xd9b08e : 0xa9cceb;
    this.scene.background.setHex(fogHex);
    this.scene.fog.color.setHex(fogHex);
    this.scene.fog.density = isRain ? 0.0085 : 0.0028;

    this.starMat.opacity = sun.isDay ? 0 : Math.min(0.92, (-el + 0.04) * 5.0);
    this.stars.visible = !sun.isDay;
  }

  render(state, forecastSnapshot, dt = 0.016) {
    if (!this.renderer || !state) return [];
    this.elapsed += dt;
    this.lastState = state;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(320, Math.round((rect.width || this.canvas.width || 960) * dpr));
    const targetH = Math.max(220, Math.round((rect.height || this.canvas.height || 580) * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(Math.round(rect.width || targetW / dpr), Math.round(rect.height || targetH / dpr), false);
    }

    const lat = state.farm?.location?.lat ?? 44.93;
    const now = new Date();
    const startYr = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now - startYr) / 86400000) + (state.simulation.dayOffset || 0);
    const sun = computeSunPosition(lat, state.simulation.hourOfDay || 10.5, doy);
    this._updateAtmosphere(state, sun);

    const H = (x, z) => getTerrainHeight(state, x, z);

    // 1. Terrain + riviere + arbres lointains
    const riverSig = (state.structures || []).filter((s) => s.type === "river_seg").map((r) => `${r.id}:${r.x}:${r.z}:${r.w}:${r.d}:${r.rot}`).join("|");
    const terrainSig = `${state.terrain?.presetId}|${state.terrain?._version || 0}|${state.farm?.gridSize}|${riverSig}`;
    if (terrainSig !== this._terrainSig || state.terrain?._dirty) {
      this._terrainSig = terrainSig;
      if (state.terrain) state.terrain._dirty = false;
      this._disposeGroupGeometries(this.terrainGroup);
      this.terrainGroup.add(buildTerrainMeshPbr(state, this.mats));
      const riv = buildRiverPbr(state, this.mats, H);
      if (riv.children.length) this.terrainGroup.add(riv);
      this.terrainGroup.add(buildPerimeterTreesPbr(state, this.geos, this.mats));
    }

    // 2. Herbe instanciee
    const layoutSig = `${(state.plots || []).map((p) => `${p.id}:${p.x}:${p.z}:${p.w}:${p.d}:${p.rot}`).join(";")}|${(state.structures || []).map((s) => `${s.id}:${s.x}:${s.z}:${s.w}:${s.d}:${s.rot}`).join(";")}`;
    const grassSig = `${this._terrainSig}|${layoutSig}`;
    if (grassSig !== this._grassSig) {
      this._grassSig = grassSig;
      this._disposeGroupGeometries(this.grassGroup);
      this.grassGroup.add(buildInstancedGrassPbr(state, this.geos, this.mats, H));
    }

    // 3. Contours cadastraux jaunes
    const cadSig = `${this._terrainSig}|${JSON.stringify(state.farm?.cadastralParcels || [])}`;
    if (cadSig !== this._cadastralSig) {
      this._cadastralSig = cadSig;
      this._disposeGroupGeometries(this.cadastralGroup);
      const { group, arPins } = buildCadastralParcelsPbr(state, this.geos, this.mats, H);
      this.cadastralGroup.add(group);
      this.cadastralPinDescs = arPins;
    }

    // 4. Parcelles, cultures, batiments, flux & GLB
    const dayKey = `${state.simulation.dayOffset || 0}|${state.simulation.scenario || "normal"}|${sun.isDay ? 1 : 0}`;
    const structProps = (state.structures || []).map((s) => `${s.id}:${s.doorOpen}:${s.scale || 1}:${s.modelUrl || ""}:${s.lightRoof ? 1 : 0}`).join(",");
    const plotProps = (state.plots || []).map((p) => `${p.id}:${p.cropId}:${p.irrigationValveOpen}:${p.ventOpeningPct}:${p.moisturePct}:${p.diseaseRisk}:${p.biTunnel ? 1 : 0}`).join(",");
    const staticSig = `${layoutSig}|${this._terrainSig}|${dayKey}|${this.overlay}|${this.selectedId}|${structProps}|${plotProps}|${this.glbCache.size}`;

    if (staticSig !== this._staticSig) {
      this._staticSig = staticSig;
      this._disposeGroupGeometries(this.staticGroup);

      const snapMap = new Map((forecastSnapshot?.plotSnapshots || []).map((s) => [s.id, s]));
      const plotsRes = buildPlotsAndCropsPbr(state, snapMap, this.geos, this.mats, this.overlay, this.selectedId, sun.isDay, H);
      const structRes = buildStructuresPbr(state, this.geos, this.mats, sun.isDay, this.selectedId, H, this.glbCache, (u) => this.loadGlbModel(u));

      this.staticGroup.add(plotsRes.group, structRes.group);

      // Calque flux energie/eau
      if (this.overlay === "energy") {
        const solar = (state.structures || []).find((s) => s.type === "solar_array");
        const tank = (state.structures || []).find((s) => s.type === "water_tank");
        const ghPlots = (state.plots || []).filter((p) => p.zone === "Serre");
        if (solar) {
          const eMat = this.mats.getVariant("standard", 0xfacc15, { emissive: 0.7, opacity: 0.82 });
          ghPlots.forEach((g) => {
            const mx = (solar.x + g.x) / 2, mz = (solar.z + g.z) / 2;
            const dist = Math.hypot(g.x - solar.x, g.z - solar.z);
            const ang = Math.atan2(g.x - solar.x, g.z - solar.z);
            const bar = new THREE.Mesh(this.geos.box, eMat);
            bar.position.set(mx, H(mx, mz) + 2.2, mz);
            bar.rotation.y = ang;
            bar.scale.set(0.16, 0.16, dist);
            this.staticGroup.add(bar);
          });
        }
        if (tank) {
          const wMat = this.mats.getVariant("standard", 0x38bdf8, { emissive: 0.6, opacity: 0.78 });
          (state.plots || []).forEach((p) => {
            const mx = (tank.x + p.x) / 2, mz = (tank.z + p.z) / 2;
            const dist = Math.hypot(p.x - tank.x, p.z - tank.z);
            const ang = Math.atan2(p.x - tank.x, p.z - tank.z);
            const bar = new THREE.Mesh(this.geos.box, wMat);
            bar.position.set(mx, H(mx, mz) + 0.5, mz);
            bar.rotation.y = ang;
            bar.scale.set(0.14, 0.14, dist);
            this.staticGroup.add(bar);
          });
        }
      }

      this.animItems = [...plotsRes.animItems, ...structRes.animItems];
      this.staticHitBoxes = [...plotsRes.hitBoxes, ...structRes.hitBoxes];
      this.staticArPinDescs = [...plotsRes.arPins, ...structRes.arPins];
    }

    // 5. Cheptel persistant anime sans reallocation
    const coopStruct = (state.structures || []).find((s) => s.type === "coop_mobile" || s.type === "coop_fixed");
    const padStruct = (state.structures || []).find((s) => s.type === "paddock") || (state.structures || []).find((s) => s.type === "barn_livestock");
    const pondStruct = (state.structures || []).find((s) => s.type === "pond");
    const poultryPad = coopStruct && !(state.livestock || []).some((l) => l.kind === "elevage")
      ? (state.structures || []).find((s) => s.type === "paddock" && Math.hypot(s.x - coopStruct.x, s.z - coopStruct.z) < 6.5)
      : null;

    const lvSig = `${(state.livestock || []).map((l) => `${l.id}:${l.speciesId}:${l.count}:${l.kind}`).join("|")}|${coopStruct?.x}:${coopStruct?.z}|${padStruct?.x}:${padStruct?.z}|${poultryPad?.id || ""}|${pondStruct?.id || ""}`;
    if (lvSig !== this._livestockSig) {
      this._livestockSig = lvSig;
      this._disposeGroupGeometries(this.livestockGroup);
      this.animalAgents = [];

      (state.livestock || []).forEach((lot, lotIdx) => {
        const spId = lot.speciesId || (lot.kind === "ponte" ? "ponte" : "bovin_lait");
        let centerX = 8 + lotIdx * 2.5, centerZ = 7, spanX = 3.2, spanZ = 2.2;
        if (spId === "ponte" && poultryPad) {
          centerX = poultryPad.x; centerZ = poultryPad.z;
          spanX = Math.max(0.7, (poultryPad.w || 3) * 0.34);
          spanZ = Math.max(0.7, (poultryPad.d || 3.2) * 0.34);
        } else if (spId === "ponte" && coopStruct) {
          centerX = coopStruct.x; centerZ = coopStruct.z + 1.5; spanX = 2.0; spanZ = 0.8;
        } else if (spId === "canard" && pondStruct) {
          centerX = pondStruct.x + 2.4; centerZ = pondStruct.z - 0.4; spanX = 1.6; spanZ = 1.0;
        } else if (padStruct) {
          const halfW = Math.max(1.2, (padStruct.w || 10) * 0.5 - 1.15);
          const halfD = Math.max(0.8, (padStruct.d || 4.4) * 0.5 - 0.95);
          const offsetX = lotIdx % 2 === 0 ? -halfW * 0.42 : halfW * 0.42;
          const offsetZ = lotIdx > 2 ? halfD * 0.35 : -halfD * 0.35;
          centerX = padStruct.x + offsetX; centerZ = padStruct.z + offsetZ;
          spanX = Math.max(0.8, halfW - Math.abs(offsetX));
          spanZ = Math.max(0.5, halfD - Math.abs(offsetZ));
        }

        const visCount = spId === "ponte" ? Math.min(8, Math.max(3, Math.ceil(lot.count / 80))) : Math.min(5, Math.max(2, Math.ceil(lot.count / 12)));
        for (let i = 0; i < visCount; i++) {
          const mesh = buildAnimalMeshPbr(spId, i + lotIdx, this.geos, this.mats);
          this.livestockGroup.add(mesh);
          this.animalAgents.push({ mesh, lot, lotIdx, idx: i, spId, centerX, centerZ, spanX, spanZ });
        }
      });
    }

    // 6. Robots persistants animes
    const bots = (state.equipment || []).filter((e) => e.autonomous);
    const robotSig = `${bots.map((b) => `${b.id}:${b.kind}:${b.status}`).join("|")}|${sun.isDay ? 1 : 0}`;
    if (robotSig !== this._robotSig) {
      this._robotSig = robotSig;
      this._disposeGroupGeometries(this.robotGroup);
      this.robotAgents = [];
      for (const eq of bots) {
        const mesh = buildRobotMeshPbr(eq, this.geos, this.mats, sun.isDay);
        this.robotGroup.add(mesh);
        this.robotAgents.push({ eq, mesh });
      }
    }

    // 7. Animations par frame
    if (this.mats.waterBump) {
      this.mats.waterBump.offset.x = (this.elapsed * 0.045) % 1;
      this.mats.waterBump.offset.y = (this.elapsed * 0.025) % 1;
    }
    for (const item of this.animItems) {
      if (item.kind === "rotorZ") item.mesh.rotation.z = this.elapsed * item.speed;
      else if (item.kind === "spinY") item.mesh.rotation.y = this.elapsed * ((state.weather?.current?.windKmh || 12) * 0.18 + 0.6);
      else if (item.kind === "drop") {
        const p = (this.elapsed * 2.5 + item.phase) % 1;
        item.mesh.position.y = item.baseY + p * 0.75;
      } else if (item.kind === "smoke") {
        const p = (this.elapsed * 0.35 + item.phase) % 1;
        item.mesh.position.set(item.baseX + Math.sin(this.elapsed + item.phase * 6) * 0.2, item.baseY + p * 1.9, item.baseZ);
        const sc = 0.28 + p * 0.55;
        item.mesh.scale.set(sc, sc * 0.8, sc);
      } else if (item.kind === "bee") {
        const ba = this.elapsed * 3.5 + item.idx * 1.57;
        item.mesh.position.set(Math.cos(ba) * 1.2, 1.25 + Math.sin(ba * 2) * 0.2, Math.sin(ba) * 0.8 + 0.5);
      }
    }

    for (const ag of this.animalAgents) {
      const phase = this.elapsed * (ag.spId === "ponte" || ag.spId === "canard" ? 1.15 : 0.38) + ag.idx * 1.9 + ag.lotIdx;
      const ax = ag.centerX + Math.sin(phase * 0.7 + ag.idx) * ag.spanX;
      const az = ag.centerZ + Math.cos(phase * 0.5 + ag.idx * 1.3) * ag.spanZ;
      const yaw = Math.atan2(Math.cos(phase * 0.7 + ag.idx), -Math.sin(phase * 0.5 + ag.idx * 1.3));
      ag.mesh.position.set(ax, H(ax, az), az);
      ag.mesh.rotation.y = yaw;
      if (ag.mesh.userData.legs?.length === 4) {
        const swing = Math.sin(phase * 3.2) * 0.26;
        ag.mesh.userData.legs[0].rotation.x = swing;
        ag.mesh.userData.legs[1].rotation.x = -swing;
        ag.mesh.userData.legs[2].rotation.x = -swing;
        ag.mesh.userData.legs[3].rotation.x = swing;
      }
    }

    const dynamicHitBoxes = [];
    const dynamicPins = [];
    const seenLotPins = new Set();
    for (const ag of this.animalAgents) {
      if (seenLotPins.has(ag.lot.id)) continue;
      seenLotPins.add(ag.lot.id);
      const cy = H(ag.centerX, ag.centerZ);
      dynamicHitBoxes.push({ kind: "livestock", id: ag.lot.id, label: ag.lot.name, x: ag.centerX, z: ag.centerZ, w: ag.spanX * 2, d: ag.spanZ * 2, y0: cy, y1: cy + 1.6, data: ag.lot });
      dynamicPins.push({ id: ag.lot.id, label: `${ag.lot.name} (${ag.lot.count})`, x: ag.centerX, y: cy + 1.8, z: ag.centerZ, warn: false });
    }

    for (const ra of this.robotAgents) {
      const eq = ra.eq;
      const rx = eq.x ?? 10, rz = eq.z ?? -6;
      const ry = H(rx, rz);
      if (eq.kind === "drone") {
        const yAlt = ry + (eq.status === "working" ? 4.4 + Math.sin(this.elapsed * 3) * 0.2 : 1.0);
        ra.mesh.position.set(rx, yAlt, rz);
        ra.mesh.rotation.y = this.elapsed * 0.45;
        for (const rt of ra.mesh.userData.rotors || []) rt.rotation.y = this.elapsed * 22;
        if (ra.mesh.userData.beam) ra.mesh.userData.beam.visible = eq.status === "working";
        dynamicHitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.8, d: 1.8, y0: ry, y1: yAlt + 0.8, data: eq });
        dynamicPins.push({ id: eq.id, label: `🚁 ${eq.name} (${Math.round(eq.batteryPct)}%)`, x: rx, y: yAlt + 0.8, z: rz, warn: eq.batteryPct < 25 });
      } else {
        ra.mesh.position.set(rx, ry, rz);
        ra.mesh.rotation.y = eq.heading ?? 0;
        const hPin = eq.kind === "tractor" ? 2.4 : 1.3;
        const icon = eq.kind === "tractor" ? "🚜" : "🤖";
        dynamicHitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: eq.kind === "tractor" ? 2.0 : 1.5, d: eq.kind === "tractor" ? 2.8 : 1.5, y0: ry, y1: ry + hPin, data: eq });
        dynamicPins.push({ id: eq.id, label: `${icon} ${eq.name} (${Math.round(eq.batteryPct)}%)`, x: rx, y: ry + hPin, z: rz, warn: eq.batteryPct < 25 });
      }
    }

    // Pluie 3D
    const rainMm = state.weather?.current?.rainMm || 0;
    this.rainGroup.visible = rainMm > 0.5;
    if (this.rainGroup.visible) {
      const span = state.farm?.gridSize || 44;
      const activeCount = Math.min(this.rainDrops.length, Math.round(rainMm * 6));
      for (let i = 0; i < this.rainDrops.length; i++) {
        const dm = this.rainDrops[i];
        dm.visible = i < activeCount;
        if (dm.visible) {
          const px = ((i * 7.3) % span) - span / 2;
          const pz = ((i * 11.7) % span) - span / 2;
          const py = 12 - ((this.elapsed * 15 + i * 1.7) % 12);
          dm.position.set(px, py, pz);
        }
      }
    }

    // Fantome construction ou cercle sculpture
    this.ghostBox.visible = false;
    this.ghostCyl.visible = false;
    if (this.sculptMode.active && this.buildMode.hoverValid) {
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      const r = this.sculptMode.radius * 2;
      this.ghostMat.color.setHex(0xfab028);
      this.ghostCyl.position.set(this.buildMode.hoverX, hy + 0.06, this.buildMode.hoverZ);
      this.ghostCyl.scale.set(r, 0.14, r);
      this.ghostCyl.visible = true;
    } else if (this.buildMode.active && this.buildMode.hoverValid) {
      const cat = BUILDING_CATALOG.find((b) => b.type === this.buildMode.type) || { w: 4, d: 4, h: 3 };
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      this.ghostMat.color.setHex(0x33f28c);
      this.ghostBox.position.set(this.buildMode.hoverX, hy + 0.04, this.buildMode.hoverZ);
      this.ghostBox.rotation.y = this.buildMode.rot || 0;
      this.ghostBox.scale.set(cat.w, cat.h, cat.d);
      this.ghostBox.visible = true;
    }

    const cssW = rect.width || this.canvas.width || 960;
    const cssH = rect.height || this.canvas.height || 580;
    this._syncThreeCamera(cssW / cssH);
    this.renderer.render(this.scene, this.threeCamera);

    this.hitBoxes = [...this.staticHitBoxes, ...dynamicHitBoxes];
    this.arPins = [];
    for (const dPin of [...this.cadastralPinDescs, ...this.staticArPinDescs, ...dynamicPins]) {
      const pt = this._projectPoint(dPin.x, dPin.y, dPin.z, cssW, cssH);
      if (pt && pt.x > 0 && pt.x < cssW && pt.y > 0 && pt.y < cssH) {
        this.arPins.push({ id: dPin.id, label: dPin.label, x: pt.x, y: pt.y, warn: dPin.warn });
      }
    }

    return this.arPins;
  }

  /**
   * Rend un cliché haute résolution (QHD / 4K) avec ombres complètes sans perturber l'UI.
   */
  exportPhotoRender({ width = 2560, height = 1440 } = {}) {
    if (!this.renderer || !this.threeCamera) return null;
    const gl = this.gl;
    const maxDims = gl ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : [4096, 4096];
    const w = Math.min(width, maxDims?.[0] || 4096);
    const h = Math.min(height, maxDims?.[1] || 4096);

    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevAspect = this.threeCamera.aspect;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this._syncThreeCamera(w / h);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.threeCamera);
    const dataUrl = this.canvas.toDataURL("image/png");

    this.renderer.setPixelRatio(prevPixelRatio);
    this.renderer.setSize(Math.max(1, Math.round(prevW / prevPixelRatio)), Math.max(1, Math.round(prevH / prevPixelRatio)), false);
    this.threeCamera.aspect = prevAspect;
    this.threeCamera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.threeCamera);

    return dataUrl;
  }
}
