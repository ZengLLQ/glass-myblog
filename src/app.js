import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BRAND_DATA } from './data.js';
import { CutPattern } from './cut-pattern.js';
import { createGlassMaterials } from './materials.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { solveHomography, toCSSMatrix3d } from './homography.js';

export class GlassHeroApp {
  constructor() {
    this.container = document.getElementById('webgl-container');
    this.domOverlay = document.getElementById('dom-panel-overlay');
    this.definitionsView = document.getElementById('definitions-view');
    this.sliverElement = document.getElementById('sliver-back-btn');
    this.definitionsContent = document.getElementById('def-content-container');
    this.definitionsTitle = document.getElementById('def-title');

    this.pattern = new CutPattern();
    this.canvasRenderer = new CanvasRenderer();

    // Scene & renderer objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.roomEnvMap = null;
    this.keyLight = null;

    // Materials manager
    this.materials = null;

    // Mesh hierarchy
    this.slabGroup = null; // Tilts globally
    this.navPiece = null;  // Nav glass mesh + decal
    this.shardPieces = {}; // Cell A, B, C, D, E pieces
    this.sliverPiece = null; // "← Back" 3D glass sliver

    // Textures
    this.panelTexture = null;
    this.navTexture = null;
    this.panelDecalMaterial = null;
    this.navDecalMaterial = null;

    // Physics / Springs for pieces: k=170, c=19
    this.springK = 170.0;
    this.springC = 19.0;

    // Pieces state
    this.piecesState = {};

    // Global tilt state (exponential smooth 0.3s)
    this.globalTilt = {
      curX: 0, curY: 0,
      targetX: 0, targetY: 0
    };

    // Pointer state
    this.pointer = {
      screenX: 0, screenY: 0,
      ndcX: 0, ndcY: 0,
      panelNormX: 0.5, panelNormY: 0.5,
      isInside: false,
      worldPos: new THREE.Vector3(0, 0, 0),
      lastMoveTime: 0
    };

    this.raycaster = new THREE.Raycaster();
    this.hoveredPieceId = null;

    // Shatter & State transitions
    // 'hero' | 'shattering' | 'definitions' | 'reassembling'
    this.viewState = 'hero';
    this.transitionStartTime = 0;
    this.activeDefinitionsTab = 'chapters'; // 'chapters' | 'facet' | 'experience' | 'education' | 'skills' | 'projects'

    // Timing
    this.clock = new THREE.Clock();
    this.lastGeomRebuildTime = 0;
    this.geomRebuildInterval = 1.0 / 45.0; // ~45 fps rebuild

    // Sizing & Scale S
    this.sizes = {
      W: window.innerWidth,
      H: window.innerHeight,
      sideMargin: 0,
      topMargin: 0,
      blockW: 0,
      blockH: 0,
      navH: 0,
      gap: 0,
      panelH: 0,
      S: 1.0,
      k: 1.0,
      isPortrait: false
    };

    this.init();
  }

  init() {
    this.calculateSizing();
    this.initThree();
    this.initMaterials();
    this.initPieces();
    this.initSliver();
    this.initDOMOverlay();
    this.initDefinitionsView();
    this.bindEvents();

    // Trigger initial fly-in animation on page load
    this.triggerLoadFlyIn();

    // Start animation loop
    this.animate();
  }

  calculateSizing() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.sizes.W = W;
    this.sizes.H = H;
    this.sizes.isPortrait = H > W;

    // Side margins: 5.5% W (16px on phones), Top/bottom: 8.5% H (16px on phones)
    const isPhone = W < 640;
    this.sizes.sideMargin = isPhone ? 16 : W * 0.055;
    this.sizes.topMargin = isPhone ? 16 : H * 0.085;

    this.sizes.blockW = W - 2 * this.sizes.sideMargin;
    this.sizes.blockH = H - 2 * this.sizes.topMargin;

    // Nav slab: 10.8% of block height
    this.sizes.navH = this.sizes.blockH * 0.108;
    this.sizes.S = this.sizes.blockW / 1730.0;
    this.sizes.gap = 14.0 * this.sizes.S;
    this.sizes.panelH = this.sizes.blockH - this.sizes.navH - this.sizes.gap;
    this.sizes.k = W / 1918.0;
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050507);

    // Perspective camera, fov 30deg, 1 world unit = 1 CSS px at z = 0
    const fov = 30;
    this.camera = new THREE.PerspectiveCamera(fov, this.sizes.W / this.sizes.H, 10, 6000);
    const cameraDist = this.sizes.H / (2 * Math.tan((fov * Math.PI) / 360));
    this.camera.position.set(0, 0, cameraDist);
    this.camera.lookAt(0, 0, 0);

    // Renderer: ACES filmic tone mapping, DPR capped at 2
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(this.sizes.W, this.sizes.H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // PMREM RoomEnvironment, environmentIntensity .42
    const pmremGen = new THREE.PMREMGenerator(this.renderer);
    pmremGen.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    this.roomEnvMap = pmremGen.fromScene(roomEnv).texture;
    this.scene.environment = this.roomEnvMap;
    this.scene.environmentIntensity = 0.42;

    // Soft white-blue key light from top-left
    this.keyLight = new THREE.DirectionalLight(0xe4edff, 1.8);
    this.keyLight.position.set(-this.sizes.W * 0.45, this.sizes.H * 0.65, 800);
    this.scene.add(this.keyLight);

    const softFill = new THREE.AmbientLight(0x1a1a24, 0.5);
    this.scene.add(softFill);

    // Master slab group holding nav and shard panel
    this.slabGroup = new THREE.Group();
    this.scene.add(this.slabGroup);
  }

  initMaterials() {
    this.materials = createGlassMaterials(THREE, this.sizes.S);

    // Textures for 2D printed content
    const panelCanvas = this.canvasRenderer.renderPanel(this.sizes.blockW, this.sizes.panelH, this.sizes.S);
    this.panelTexture = new THREE.CanvasTexture(panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panelTexture.minFilter = THREE.LinearFilter;
    this.panelTexture.magFilter = THREE.LinearFilter;
    this.panelTexture.generateMipmaps = false;

    const navCanvas = this.canvasRenderer.renderNav(this.sizes.blockW, this.sizes.navH, this.sizes.S);
    this.navTexture = new THREE.CanvasTexture(navCanvas);
    this.navTexture.colorSpace = THREE.SRGBColorSpace;
    this.navTexture.minFilter = THREE.LinearFilter;
    this.navTexture.magFilter = THREE.LinearFilter;
    this.navTexture.generateMipmaps = false;

    // Decal materials for top face: transparent, polygonOffset to eliminate Z-fighting
    this.panelDecalMaterial = new THREE.MeshBasicMaterial({
      map: this.panelTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    this.navDecalMaterial = new THREE.MeshBasicMaterial({
      map: this.navTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
  }

  initPieces() {
    // 1. Nav Slab Piece
    const navMat = this.materials.createPieceMaterial();
    const navGroup = new THREE.Group();
    navGroup.name = 'nav';

    this.navPiece = {
      id: 'nav',
      group: navGroup,
      glassMesh: null,
      decalMesh: null,
      material: navMat,
      // Target & live spring physics
      z: 0, vz: 0, targetZ: 0,
      rotX: 0, vRotX: 0, targetRotX: 0,
      rotY: 0, vRotY: 0, targetRotY: 0,
      // Shatter physics
      shatterVelocity: new THREE.Vector3(),
      shatterRotAxis: new THREE.Vector3(1, 0, 0),
      shatterRotSpeed: 0,
      startPos: new THREE.Vector3(),
      startRot: new THREE.Euler(),
      homePos: new THREE.Vector3(0, this.sizes.blockH / 2 - this.sizes.navH / 2, 0)
    };

    navGroup.position.copy(this.navPiece.homePos);
    this.slabGroup.add(navGroup);
    this.piecesState['nav'] = this.navPiece;

    // 2. Five Shard Cells (A, B, C, D, E)
    const cellKeys = ['A', 'B', 'C', 'D', 'E'];
    this.shardPieces = {};

    const panelCenterY = this.sizes.blockH / 2 - this.sizes.navH - this.sizes.gap - this.sizes.panelH / 2;

    for (const k of cellKeys) {
      const pieceGroup = new THREE.Group();
      pieceGroup.name = k;
      const pieceMat = this.materials.createPieceMaterial();

      const piece = {
        id: k,
        group: pieceGroup,
        glassMesh: null,
        decalMesh: null,
        material: pieceMat,
        z: 0, vz: 0, targetZ: 0,
        rotX: 0, vRotX: 0, targetRotX: 0,
        rotY: 0, vRotY: 0, targetRotY: 0,
        shatterVelocity: new THREE.Vector3(),
        shatterRotAxis: new THREE.Vector3(0, 1, 0),
        shatterRotSpeed: 0,
        startPos: new THREE.Vector3(),
        startRot: new THREE.Euler(),
        homePos: new THREE.Vector3(0, panelCenterY, 0)
      };

      pieceGroup.position.copy(piece.homePos);
      this.slabGroup.add(pieceGroup);
      this.shardPieces[k] = piece;
      this.piecesState[k] = piece;
    }

    // Build initial geometry
    this.rebuildNavGeometry();
    this.rebuildShardGeometries(0);
  }

  initSliver() {
    // "← Back" sliver: thin smoked-glass shard
    // Outline: viewport fractions (.147,.243) (.252,.169) (.287,.277) (.151,.258)
    // Extrusion 11*k, bevel 2.2*k, k = W/1918
    const W = this.sizes.W;
    const H = this.sizes.H;
    const k = this.sizes.k;

    const vpts = [
      [0.147, 0.243],
      [0.252, 0.169],
      [0.287, 0.277],
      [0.151, 0.258]
    ];

    // Compute center of sliver in 3D world coordinates
    let avgX = 0, avgY = 0;
    const worldPts = vpts.map(([fx, fy]) => {
      const wx = (fx - 0.5) * W;
      const wy = (0.5 - fy) * H;
      avgX += wx;
      avgY += wy;
      return [wx, wy];
    });
    avgX /= 4;
    avgY /= 4;

    // Centered local points
    const localPts = worldPts.map(([wx, wy]) => [wx - avgX, wy - avgY]);

    const shape = CutPattern.buildFilletedShape(THREE, localPts, 14 * k);
    const extrudeSettings = {
      depth: 11 * k,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 2.2 * k,
      bevelThickness: 2.2 * k
    };

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.center();

    const sliverMesh = new THREE.Mesh(geom, this.materials.sliverMaterial);
    const sliverGroup = new THREE.Group();
    sliverGroup.add(sliverMesh);

    sliverGroup.position.set(avgX, avgY, 150);
    sliverGroup.rotation.y = -0.16;
    sliverGroup.rotation.x = 0.08;
    sliverGroup.scale.set(0, 0, 0); // hidden initially

    this.scene.add(sliverGroup);

    this.sliverPiece = {
      group: sliverGroup,
      mesh: sliverMesh,
      basePos: new THREE.Vector3(avgX, avgY, 150),
      baseRot: new THREE.Euler(0.08, -0.16, 0),
      rotX: 0.08, rotY: -0.16,
      targetRotX: 0.08, targetRotY: -0.16,
      scale: 0,
      targetScale: 0,
      isHovered: false
    };
  }

  rebuildNavGeometry() {
    const W = this.sizes.blockW;
    const H = this.sizes.navH;
    const S = this.sizes.S;

    const r = 20.0 * S;
    const shape = new THREE.Shape();
    const hw = W / 2;
    const hh = H / 2;

    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

    const extrudeSettings = {
      depth: 13.0 * S,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 2.6 * S,
      bevelThickness: 2.6 * S,
      curveSegments: 4
    };

    const glassGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Center extrusion along depth
    glassGeom.translate(0, 0, -13.0 * S / 2);

    if (this.navPiece.glassMesh) {
      this.navPiece.glassMesh.geometry.dispose();
      this.navPiece.glassMesh.geometry = glassGeom;
    } else {
      this.navPiece.glassMesh = new THREE.Mesh(glassGeom, this.navPiece.material);
      this.navPiece.group.add(this.navPiece.glassMesh);
    }

    // Nav Decal Mesh
    const decalGeom = new THREE.ShapeGeometry(shape);
    // Map UVs: x in [-hw, hw] -> [0, 1], y in [-hh, hh] -> [0, 1]
    const uvs = decalGeom.attributes.uv;
    const pos = decalGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + hw) / W;
      const v = (pos.getY(i) + hh) / H;
      uvs.setXY(i, u, v);
    }
    uvs.needsUpdate = true;

    const zFace = 13.0 * S / 2 + 2.6 * S + 1.2 * S;
    if (this.navPiece.decalMesh) {
      this.navPiece.decalMesh.geometry.dispose();
      this.navPiece.decalMesh.geometry = decalGeom;
      this.navPiece.decalMesh.position.z = zFace;
    } else {
      this.navPiece.decalMesh = new THREE.Mesh(decalGeom, this.navDecalMaterial);
      this.navPiece.decalMesh.position.z = zFace;
      this.navPiece.group.add(this.navPiece.decalMesh);
    }
  }

  rebuildShardGeometries(time) {
    const W = this.sizes.blockW;
    const H = this.sizes.panelH;
    const S = this.sizes.S;
    const isPortrait = this.sizes.isPortrait;
    const panelCenterY = this.sizes.blockH / 2 - this.sizes.navH - this.sizes.gap - this.sizes.panelH / 2;

    // Normalized pointer relative to panel
    const pointerPanel = this.pointer.isInside
      ? { x: this.pointer.panelNormX, y: this.pointer.panelNormY }
      : null;

    const evaluatedPts = this.pattern.evaluatePoints(time, pointerPanel, isPortrait);
    const cells = this.pattern.getCells(evaluatedPts);

    const cornerRadius = 20.0 * S;
    const depth = 13.0 * S;
    const bevel = 2.6 * S;
    const inset = 7.0 * S; // half gap = 7*S (14*S total gap)

    const extrudeSettings = {
      depth,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
      curveSegments: 4
    };

    for (const [k, normPoly] of Object.entries(cells)) {
      const piece = this.shardPieces[k];
      if (!piece) continue;

      // Centroid in normalized coordinates
      const [cenU, cenV] = CutPattern.getCentroid(normPoly);
      const cenX = (cenU - 0.5) * W;
      const cenY = (0.5 - cenV) * H;

      // Update piece home position to its centroid
      piece.homePos.set(cenX, panelCenterY + cenY, 0);
      if (this.viewState === 'hero') {
        piece.group.position.x = piece.homePos.x;
        piece.group.position.y = piece.homePos.y;
      }

      // Convert normalized [0, 1] to local 3D coordinates relative to piece centroid
      const polyLocal = normPoly.map(([u, v]) => [
        (u - 0.5) * W - cenX,
        (0.5 - v) * H - cenY
      ]);

      // Inset polygon by half gap (7*S)
      const insetPoly = CutPattern.insetPolygon(polyLocal, inset);

      // Fillet corners with 20*S radius
      const shape = CutPattern.buildFilletedShape(THREE, insetPoly, cornerRadius);

      // Glass body extrusion
      const glassGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      glassGeom.translate(0, 0, -depth / 2);

      if (piece.glassMesh) {
        piece.glassMesh.geometry.dispose();
        piece.glassMesh.geometry = glassGeom;
      } else {
        piece.glassMesh = new THREE.Mesh(glassGeom, piece.material);
        piece.group.add(piece.glassMesh);
      }

      // Decal ShapeGeometry carrying slice of text
      const decalGeom = new THREE.ShapeGeometry(shape);
      const uvs = decalGeom.attributes.uv;
      const pos = decalGeom.attributes.position;

      // UV mapping: map vertex world position (relative to panel) to original page texture
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const ly = pos.getY(i);
        const vx = lx + cenX;
        const vy = ly + cenY;
        const u = (vx + W / 2) / W;
        const v = (vy + H / 2) / H;
        uvs.setXY(i, u, v);
      }
      uvs.needsUpdate = true;

      const zFace = depth / 2 + bevel + 1.2 * S;
      if (piece.decalMesh) {
        piece.decalMesh.geometry.dispose();
        piece.decalMesh.geometry = decalGeom;
        piece.decalMesh.position.z = zFace;
      } else {
        piece.decalMesh = new THREE.Mesh(decalGeom, this.panelDecalMaterial);
        piece.decalMesh.position.z = zFace;
        piece.group.add(piece.decalMesh);
      }
    }
  }

  initDOMOverlay() {
    this.updateDOMOverlayHTML();
    this.syncDOMOverlayTransform();
  }

  updateDOMOverlayHTML() {
    const isJaycee = this.canvasRenderer.mode === 'jaycee';

    this.domOverlay.innerHTML = `
      <div class="dom-nav-row" style="height: ${this.sizes.navH}px;">
        <div class="dom-nav-left" id="dom-brand-btn" title="Toggle Jaycee / Facet mode">
          <span class="dom-mark">${isJaycee ? 'JC' : 'F'}</span>
          <span class="dom-brand-name">${isJaycee ? 'Jaycee 曾令强' : 'Facet'}</span>
          <span class="dom-mode-pill">${isJaycee ? 'Portfolio' : 'Facet Spec'}</span>
        </div>
        <div class="dom-nav-center">
          <a href="#about" class="dom-nav-link" data-tab="chapters">Story</a>
          <a href="#experience" class="dom-nav-link" data-tab="experience">Experience</a>
          <a href="#education" class="dom-nav-link" data-tab="education">Education</a>
          <a href="#projects" class="dom-nav-link" data-tab="projects">Projects</a>
        </div>
        <div class="dom-nav-right">
          <a href="${BRAND_DATA.contacts.whatsapp}" target="_blank" rel="noopener noreferrer" class="dom-nav-action" id="dom-nav-contact">Say hello</a>
        </div>
      </div>

      <div class="dom-panel-content" style="height: ${this.sizes.panelH}px; margin-top: ${this.sizes.gap}px;">
        <p class="dom-eyebrow">${isJaycee ? 'FREELANCE BACK-END DEVELOPER & PENETRATION TESTER' : 'REAL-TIME MATERIAL STUDIO'}</p>
        <h1 class="dom-headline">
          <span>${isJaycee ? 'Jaycee' : 'Designed'}</span><br>
          <span>${isJaycee ? '曾令强.' : 'in glass.'}</span>
        </h1>
        <p class="dom-sub">
          ${isJaycee
            ? 'Building secure, resilient back-ends — and breaking them first. Live<br>previews, real systems, and a little magic in every line of code.'
            : 'Author dispersion, transmission, and refraction in the browser. Live<br>previews, real materials.'}
        </p>
        <div class="dom-cta-row">
          <button type="button" class="dom-pill-btn" id="dom-open-studio-btn">
            ${isJaycee ? 'Say hello' : 'Open studio'}
          </button>
          <button type="button" class="dom-paper-link" id="dom-read-paper-btn">
            ${isJaycee ? 'Read story & paper →' : 'Read paper →'}
          </button>
        </div>
        <div class="dom-panel-footer">
          <span>${isJaycee ? '© Jaycee 曾令强' : '© Facet Lab'}</span>
          <span>${isJaycee ? 'Surabaya · Jember / Index 2026' : 'KHR_materials_dispersion'}</span>
        </div>
      </div>
    `;

    // Rebind DOM click listeners
    const brandBtn = document.getElementById('dom-brand-btn');
    if (brandBtn) {
      brandBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleBrandMode();
      });
    }

    const openStudioBtn = document.getElementById('dom-open-studio-btn');
    if (openStudioBtn) {
      openStudioBtn.addEventListener('click', () => {
        window.open(BRAND_DATA.contacts.whatsapp, '_blank');
      });
      openStudioBtn.addEventListener('mouseenter', () => {
        this.canvasRenderer.isButtonHovered = true;
        this.refreshCanvasTextures();
      });
      openStudioBtn.addEventListener('mouseleave', () => {
        this.canvasRenderer.isButtonHovered = false;
        this.refreshCanvasTextures();
      });
    }

    const readPaperBtn = document.getElementById('dom-read-paper-btn');
    if (readPaperBtn) {
      readPaperBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.triggerShatter('chapters');
      });
      readPaperBtn.addEventListener('mouseenter', () => {
        this.canvasRenderer.isLinkHovered = true;
        this.refreshCanvasTextures();
      });
      readPaperBtn.addEventListener('mouseleave', () => {
        this.canvasRenderer.isLinkHovered = false;
        this.refreshCanvasTextures();
      });
    }

    const navLinks = this.domOverlay.querySelectorAll('.dom-nav-link');
    navLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = link.getAttribute('data-tab');
        this.triggerShatter(tab);
      });
    });

    const navContact = document.getElementById('dom-nav-contact');
    if (navContact) {
      navContact.addEventListener('mouseenter', () => {
        this.canvasRenderer.isNavContactHovered = true;
        this.refreshCanvasTextures();
      });
      navContact.addEventListener('mouseleave', () => {
        this.canvasRenderer.isNavContactHovered = false;
        this.refreshCanvasTextures();
      });
    }
  }

  toggleBrandMode() {
    this.canvasRenderer.toggleMode();
    this.refreshCanvasTextures();
    this.updateDOMOverlayHTML();
    this.renderDefinitionsContent();
  }

  refreshCanvasTextures() {
    this.canvasRenderer.renderPanel(this.sizes.blockW, this.sizes.panelH, this.sizes.S);
    this.panelTexture.needsUpdate = true;

    this.canvasRenderer.renderNav(this.sizes.blockW, this.sizes.navH, this.sizes.S);
    this.navTexture.needsUpdate = true;
  }

  syncDOMOverlayTransform() {
    if (!this.domOverlay || !this.slabGroup || !this.camera) return;

    // Corner points of panel block in world space:
    const bw = this.sizes.blockW;
    const bh = this.sizes.blockH;
    const hw = bw / 2;
    const hh = bh / 2;

    const corners3D = [
      new THREE.Vector3(-hw, hh, 0), // TL
      new THREE.Vector3(hw, hh, 0),  // TR
      new THREE.Vector3(hw, -hh, 0), // BR
      new THREE.Vector3(-hw, -hh, 0) // BL
    ];

    // Project each corner to screen pixel coordinates
    const dst = corners3D.map((pt) => {
      const v = pt.clone();
      v.applyMatrix4(this.slabGroup.matrixWorld);
      v.project(this.camera);

      return {
        x: (v.x * 0.5 + 0.5) * this.sizes.W,
        y: (-v.y * 0.5 + 0.5) * this.sizes.H
      };
    });

    const src = [
      { x: 0, y: 0 },
      { x: bw, y: 0 },
      { x: bw, y: bh },
      { x: 0, y: bh }
    ];

    const homographyMatrix = solveHomography(src, dst);
    this.domOverlay.style.width = `${bw}px`;
    this.domOverlay.style.height = `${bh}px`;
    this.domOverlay.style.transformOrigin = '0 0';
    this.domOverlay.style.transform = toCSSMatrix3d(homographyMatrix);
  }

  initDefinitionsView() {
    this.renderDefinitionsContent();

    // Bind back sliver button click
    if (this.sliverElement) {
      this.sliverElement.addEventListener('click', (e) => {
        e.preventDefault();
        this.triggerBack();
      });
      this.sliverElement.addEventListener('mouseenter', () => {
        if (this.sliverPiece) this.sliverPiece.isHovered = true;
      });
      this.sliverElement.addEventListener('mouseleave', () => {
        if (this.sliverPiece) this.sliverPiece.isHovered = false;
      });
    }

    // Bind tab clicks in secondary view
    const tabBtns = document.querySelectorAll('.def-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        this.setActiveDefinitionsTab(tab);
      });
    });
  }

  setActiveDefinitionsTab(tab) {
    this.activeDefinitionsTab = tab;
    const tabBtns = document.querySelectorAll('.def-tab-btn');
    tabBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    this.renderDefinitionsContent();
  }

  renderDefinitionsContent() {
    if (!this.definitionsContent) return;

    const tab = this.activeDefinitionsTab;

    if (tab === 'chapters') {
      this.definitionsTitle.textContent = "Jaycee's Story, in five chapters.";
      this.definitionsContent.innerHTML = BRAND_DATA.chapters.map(c => `
        <div class="def-paragraph">
          <span class="def-term">${c.heading}</span> — ${c.text}
        </div>
      `).join('');
    } else if (tab === 'facet') {
      this.definitionsTitle.textContent = "Real-time glass, in five terms.";
      this.definitionsContent.innerHTML = BRAND_DATA.facetTerms.map(t => `
        <div class="def-paragraph">
          <span class="def-term">${t.term}</span> — ${t.text}
        </div>
      `).join('');
    } else if (tab === 'experience') {
      this.definitionsTitle.textContent = "Where I've worked & built.";
      this.definitionsContent.innerHTML = BRAND_DATA.experience.map(j => `
        <div class="def-paragraph">
          <span class="def-term">${j.role}</span> — ${j.company} (${j.period}) · ${j.type} ${j.current ? '· [Current]' : ''}
        </div>
      `).join('');
    } else if (tab === 'education') {
      this.definitionsTitle.textContent = "The education journey.";
      this.definitionsContent.innerHTML = BRAND_DATA.education.map(e => `
        <div class="def-paragraph">
          <span class="def-term">${e.name}</span> — ${e.years} · ${e.level} (${e.place}) ${e.current ? '· [Currently studying]' : ''}
        </div>
      `).join('');
    } else if (tab === 'skills') {
      this.definitionsTitle.textContent = "Disciplines & capabilities.";
      this.definitionsContent.innerHTML = BRAND_DATA.skills.map(s => `
        <div class="def-paragraph">
          <span class="def-term">${s.title}</span> — ${s.blurb} [${s.tags.join(', ')}]
        </div>
      `).join('');
    } else if (tab === 'projects') {
      this.definitionsTitle.textContent = "Selected works & repositories.";
      this.definitionsContent.innerHTML = BRAND_DATA.projects.map(p => `
        <div class="def-paragraph">
          <span class="def-term">${p.title} (${p.eyebrow})</span> — ${p.desc} [${p.tags.join(', ')}]
        </div>
      `).join('') + `
        <div class="def-paragraph" style="margin-top: 1.5vw;">
          <span class="def-term">GitHub Repository</span> — Explore full source and security tools at <a href="${BRAND_DATA.contacts.github}" target="_blank" style="color: #ffffff; text-decoration: underline;">github.com/ZengLLQ</a>.
        </div>
      `;
    }
  }

  triggerLoadFlyIn() {
    this.viewState = 'reassembling';
    this.transitionStartTime = this.clock.getElapsedTime();

    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    keys.forEach((k) => {
      const piece = this.piecesState[k];
      const S = this.sizes.S;

      let vx = 0;
      let vy = 0;
      if (k === 'nav') {
        vx = (Math.random() - 0.5) * 200 * S;
        vy = (600 + Math.random() * 200) * S; // flies up
      } else if (k === 'A') {
        vx = -(1100 + Math.random() * 250) * S; // flies far left
        vy = -(400 + Math.random() * 200) * S;  // flies down
      } else if (k === 'B') {
        vx = -(950 + Math.random() * 200) * S;  // flies left
        vy = -(450 + Math.random() * 200) * S;  // flies down
      } else if (k === 'C') {
        vx = +(950 + Math.random() * 200) * S;  // flies right
        vy = -(450 + Math.random() * 200) * S;  // flies down
      } else if (k === 'D') {
        vx = +(1100 + Math.random() * 250) * S; // flies far right
        vy = -(500 + Math.random() * 200) * S;  // flies down
      } else if (k === 'E') {
        vx = +(1300 + Math.random() * 300) * S; // flies far right
        vy = -(400 + Math.random() * 200) * S;  // flies down
      }

      const vz = (440.0 + Math.random() * 320.0) * S;
      const gravity = (k === 'nav' ? 0 : 500.0 * S);

      piece.startPos.set(
        piece.homePos.x + vx,
        piece.homePos.y + vy - gravity,
        piece.homePos.z + vz
      );

      const rotSpeed = 2.0 + Math.random() * 1.6;
      piece.startRot.set(
        (Math.random() - 0.5) * rotSpeed,
        (Math.random() - 0.5) * rotSpeed,
        (Math.random() - 0.5) * rotSpeed
      );

      piece.group.position.copy(piece.startPos);
      piece.group.rotation.copy(piece.startRot);
    });

    if (this.sliverPiece) {
      this.sliverPiece.scale = 0;
      this.sliverPiece.group.scale.set(0, 0, 0);
      this.sliverPiece.group.visible = false;
    }
    if (this.sliverElement) {
      this.sliverElement.style.opacity = '0';
      this.sliverElement.style.pointerEvents = 'none';
    }
    if (this.definitionsView) {
      this.definitionsView.style.opacity = '0';
      this.definitionsView.style.pointerEvents = 'none';
    }
  }

  triggerShatter(targetTab = 'chapters') {
    if (this.viewState !== 'hero') return;

    this.viewState = 'shattering';
    this.transitionStartTime = this.clock.getElapsedTime();
    this.setActiveDefinitionsTab(targetTab);

    // Save initial resting positions & compute shatter trajectory
    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    keys.forEach((k) => {
      const piece = this.piecesState[k];
      const S = this.sizes.S;

      piece.startPos.copy(piece.group.position);
      piece.startRot.copy(piece.group.rotation);

      // Outward direction from block center to clear 32.4% - 66.3% W definitions column completely
      let vx = 0;
      let vy = 0;
      if (k === 'nav') {
        vx = (Math.random() - 0.5) * 200 * S;
        vy = (600 + Math.random() * 200) * S; // flies up
      } else if (k === 'A') {
        vx = -(1100 + Math.random() * 250) * S; // flies far left
        vy = -(400 + Math.random() * 200) * S;  // flies down
      } else if (k === 'B') {
        vx = -(950 + Math.random() * 200) * S;  // flies left
        vy = -(450 + Math.random() * 200) * S;  // flies down
      } else if (k === 'C') {
        vx = +(950 + Math.random() * 200) * S;  // flies right
        vy = -(450 + Math.random() * 200) * S;  // flies down
      } else if (k === 'D') {
        vx = +(1100 + Math.random() * 250) * S; // flies far right
        vy = -(500 + Math.random() * 200) * S;  // flies down
      } else if (k === 'E') {
        vx = +(1300 + Math.random() * 300) * S; // flies far right
        vy = -(400 + Math.random() * 200) * S;  // flies down
      }

      // 420-800*S towards camera
      const vz = (440.0 + Math.random() * 320.0) * S;
      piece.shatterVelocity.set(vx, vy, vz);

      // Random tumble axis and speed (2.0 - 3.6 rad)
      const axis = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();
      piece.shatterRotAxis.copy(axis);
      piece.shatterRotSpeed = 2.0 + Math.random() * 1.6;
    });

    if (this.sliverPiece) {
      this.sliverPiece.group.visible = true;
      this.sliverPiece.scale = 0;
      this.sliverPiece.group.scale.set(0, 0, 0);
    }

    // Hide DOM text layer immediately so it doesn't block shattered view
    this.domOverlay.style.opacity = '0';
    this.domOverlay.style.pointerEvents = 'none';
  }

  triggerBack() {
    if (this.viewState !== 'definitions') return;

    this.viewState = 'reassembling';
    this.transitionStartTime = this.clock.getElapsedTime();

    // Start positions are where shards currently landed
    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    keys.forEach((k) => {
      const piece = this.piecesState[k];
      piece.startPos.copy(piece.group.position);
      piece.startRot.copy(piece.group.rotation);
    });

    // Fade out definitions over 0.25s and shrink sliver
    if (this.definitionsView) {
      this.definitionsView.style.transition = 'opacity 0.25s ease';
      this.definitionsView.style.opacity = '0';
      this.definitionsView.style.pointerEvents = 'none';
    }
    if (this.sliverElement) {
      this.sliverElement.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      this.sliverElement.style.opacity = '0';
      this.sliverElement.style.transform = 'translate(-50%, -50%) scale(0.6)';
      this.sliverElement.style.pointerEvents = 'none';
    }
    if (this.sliverPiece) {
      this.sliverPiece.targetScale = 0;
    }
  }

  updateShatterAnimation(elapsed) {
    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    const totalDuration = 0.72;
    const S = this.sizes.S;

    let allFinished = true;

    keys.forEach((k, idx) => {
      const piece = this.piecesState[k];
      // Small stagger per piece (nav first at t=0, shards at 0.03*idx)
      const stagger = k === 'nav' ? 0.0 : 0.04 * idx;
      const pieceElapsed = Math.max(0, elapsed - stagger);

      if (pieceElapsed < totalDuration) {
        allFinished = false;
        // Ease-in cubic: t^3
        const progress = Math.min(pieceElapsed / totalDuration, 1.0);
        const easeIn = progress * progress * progress;

        // Position: startPos + velocity * easeIn + downward gravity
        const gravity = (k === 'nav' ? 0 : 500.0 * S * easeIn * easeIn);
        piece.group.position.x = piece.startPos.x + piece.shatterVelocity.x * easeIn;
        piece.group.position.y = piece.startPos.y + piece.shatterVelocity.y * easeIn - gravity;
        piece.group.position.z = piece.startPos.z + piece.shatterVelocity.z * easeIn;

        // Tumble
        piece.group.rotation.x = piece.startRot.x + piece.shatterRotAxis.x * piece.shatterRotSpeed * easeIn;
        piece.group.rotation.y = piece.startRot.y + piece.shatterRotAxis.y * piece.shatterRotSpeed * easeIn;
        piece.group.rotation.z = piece.startRot.z + piece.shatterRotAxis.z * piece.shatterRotSpeed * easeIn;
      } else {
        // Shard reached distant shattered location
        const gravity = (k === 'nav' ? 0 : 500.0 * S);
        piece.group.position.x = piece.startPos.x + piece.shatterVelocity.x;
        piece.group.position.y = piece.startPos.y + piece.shatterVelocity.y - gravity;
        piece.group.position.z = piece.startPos.z + piece.shatterVelocity.z;
        piece.group.rotation.x = piece.startRot.x + piece.shatterRotAxis.x * piece.shatterRotSpeed;
        piece.group.rotation.y = piece.startRot.y + piece.shatterRotAxis.y * piece.shatterRotSpeed;
        piece.group.rotation.z = piece.startRot.z + piece.shatterRotAxis.z * piece.shatterRotSpeed;
      }
    });

    // From 0.28s, definitions view fades in on black over 0.4s
    if (elapsed >= 0.28) {
      const defProgress = Math.min((elapsed - 0.28) / 0.4, 1.0);
      if (this.definitionsView) {
        this.definitionsView.style.opacity = `${defProgress}`;
        this.definitionsView.style.pointerEvents = defProgress > 0.8 ? 'auto' : 'none';
      }
    }

    // "← Back" sliver grows in from 0.3s after click
    if (elapsed >= 0.3) {
      const sliverProgress = Math.min((elapsed - 0.3) / 0.35, 1.0);
      const easeOut = 1 - Math.pow(1 - sliverProgress, 3);
      if (this.sliverPiece) {
        this.sliverPiece.scale = easeOut;
        this.sliverPiece.group.scale.set(easeOut, easeOut, easeOut);
      }
      if (this.sliverElement) {
        this.sliverElement.style.opacity = `${sliverProgress}`;
        this.sliverElement.style.transform = `translate(-50%, -50%) scale(${0.7 + easeOut * 0.3})`;
        this.sliverElement.style.pointerEvents = sliverProgress > 0.7 ? 'auto' : 'none';
      }
    }

    if (allFinished && elapsed >= 0.72) {
      this.viewState = 'definitions';
    }
  }

  updateReassembleAnimation(elapsed) {
    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    const totalDuration = 0.72;
    let allFinished = true;

    // Ease-out back (with slight overshoot)
    const c1 = 1.70158;
    const c3 = c1 + 1;
    function easeOutBack(x) {
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    keys.forEach((k, idx) => {
      const piece = this.piecesState[k];
      // Nav first, then 30ms stagger
      const stagger = k === 'nav' ? 0.0 : 0.03 * idx;
      const pieceElapsed = Math.max(0, elapsed - stagger);

      if (pieceElapsed < totalDuration) {
        allFinished = false;
        const progress = Math.min(pieceElapsed / totalDuration, 1.0);
        const ease = Math.max(0, easeOutBack(progress));

        piece.group.position.lerpVectors(piece.startPos, piece.homePos, ease);
        piece.group.rotation.x = piece.startRot.x * (1 - ease);
        piece.group.rotation.y = piece.startRot.y * (1 - ease);
        piece.group.rotation.z = piece.startRot.z * (1 - ease);
      } else {
        piece.group.position.copy(piece.homePos);
        piece.group.rotation.set(0, 0, 0);
        piece.z = 0;
        piece.vz = 0;
        piece.rotX = 0;
        piece.vRotX = 0;
        piece.rotY = 0;
        piece.vRotY = 0;
      }
    });

    // Shrink sliver away over 0.25s
    if (this.sliverPiece) {
      const shrinkProgress = Math.min(elapsed / 0.25, 1.0);
      const sliverScale = Math.max(0, 1.0 - shrinkProgress);
      this.sliverPiece.scale = sliverScale;
      this.sliverPiece.group.scale.set(sliverScale, sliverScale, sliverScale);
      if (sliverScale <= 0.001) {
        this.sliverPiece.group.visible = false;
      }
    }

    if (allFinished && elapsed >= 0.72) {
      this.viewState = 'hero';
      this.domOverlay.style.opacity = '1';
      this.domOverlay.style.pointerEvents = 'auto';
      if (this.sliverPiece) {
        this.sliverPiece.group.visible = false;
        this.sliverPiece.scale = 0;
        this.sliverPiece.group.scale.set(0, 0, 0);
      }
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onWindowResize());

    window.addEventListener('mousemove', (e) => {
      this.pointer.screenX = e.clientX;
      this.pointer.screenY = e.clientY;
      this.pointer.ndcX = (e.clientX / this.sizes.W) * 2 - 1;
      this.pointer.ndcY = -(e.clientY / this.sizes.H) * 2 + 1;
      this.pointer.isInside = true;
      this.pointer.lastMoveTime = this.clock.getElapsedTime();

      // Normalized panel coordinates [0, 1]
      const bw = this.sizes.blockW;
      const bh = this.sizes.panelH;
      const panelLeft = (this.sizes.W - bw) / 2;
      const panelTop = (this.sizes.H - this.sizes.blockH) / 2 + this.sizes.navH + this.sizes.gap;

      this.pointer.panelNormX = (e.clientX - panelLeft) / bw;
      this.pointer.panelNormY = (e.clientY - panelTop) / bh;

      // Global tilt target:
      // rotateY = x*7deg - 1.2deg, rotateX = -y*5.5deg + .8deg
      const normX = this.pointer.ndcX; // -1 to 1
      const normY = -this.pointer.ndcY; // -1 to 1 (screen Y down)

      this.globalTilt.targetY = normX * (7.0 * Math.PI / 180.0) - (1.2 * Math.PI / 180.0);
      this.globalTilt.targetX = -normY * (5.5 * Math.PI / 180.0) + (0.8 * Math.PI / 180.0);

      // Unproject world position at z=0 for cursor glow
      const vector = new THREE.Vector3(this.pointer.ndcX, this.pointer.ndcY, 0.5);
      vector.unproject(this.camera);
      const dir = vector.sub(this.camera.position).normalize();
      const distance = -this.camera.position.z / dir.z;
      this.pointer.worldPos.copy(this.camera.position).add(dir.multiplyScalar(distance));
      this.materials.cursorUniforms.uCursorWorld.value.copy(this.pointer.worldPos);
    });

    window.addEventListener('mouseleave', () => {
      this.pointer.isInside = false;
      this.globalTilt.targetX = 0;
      this.globalTilt.targetY = 0;
      this.hoveredPieceId = null;
    });

    window.addEventListener('click', (e) => {
      // Raycast click fallback
      if (this.viewState === 'hero') {
        this.raycastHover();
      }
    });
  }

  onWindowResize() {
    this.calculateSizing();

    const fov = 30;
    this.camera.aspect = this.sizes.W / this.sizes.H;
    const cameraDist = this.sizes.H / (2 * Math.tan((fov * Math.PI) / 360));
    this.camera.position.set(0, 0, cameraDist);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.sizes.W, this.sizes.H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));

    this.materials.setGlowRadius(300.0 * this.sizes.S);

    // Update positions & geometries
    const panelCenterY = this.sizes.blockH / 2 - this.sizes.navH - this.sizes.gap - this.sizes.panelH / 2;
    this.navPiece.homePos.set(0, this.sizes.blockH / 2 - this.sizes.navH / 2, 0);
    this.navPiece.group.position.copy(this.navPiece.homePos);

    for (const k of ['A', 'B', 'C', 'D', 'E']) {
      this.shardPieces[k].homePos.set(0, panelCenterY, 0);
      this.shardPieces[k].group.position.copy(this.shardPieces[k].homePos);
    }

    this.refreshCanvasTextures();
    this.rebuildNavGeometry();
    this.rebuildShardGeometries(this.clock.getElapsedTime());
    this.updateDOMOverlayHTML();
    this.syncDOMOverlayTransform();
  }

  raycastHover() {
    if (!this.pointer.isInside) {
      this.hoveredPieceId = null;
      return;
    }

    this.raycaster.setFromCamera(
      new THREE.Vector2(this.pointer.ndcX, this.pointer.ndcY),
      this.camera
    );

    const testMeshes = [];
    if (this.navPiece && this.navPiece.glassMesh) testMeshes.push(this.navPiece.glassMesh);
    for (const k of ['A', 'B', 'C', 'D', 'E']) {
      if (this.shardPieces[k] && this.shardPieces[k].glassMesh) {
        testMeshes.push(this.shardPieces[k].glassMesh);
      }
    }

    const intersects = this.raycaster.intersectObjects(testMeshes, false);
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      const parentGroup = hitMesh.parent;
      this.hoveredPieceId = parentGroup ? parentGroup.name : null;
    } else {
      this.hoveredPieceId = null;
    }
  }

  updatePhysics(dt) {
    const S = this.sizes.S;

    // 1. Exponential smoothing for global tilt: 0.3s
    const smoothFactor = 1.0 - Math.exp(-dt / 0.3);
    this.globalTilt.curX += (this.globalTilt.targetX - this.globalTilt.curX) * smoothFactor;
    this.globalTilt.curY += (this.globalTilt.targetY - this.globalTilt.curY) * smoothFactor;

    this.slabGroup.rotation.x = this.globalTilt.curX;
    this.slabGroup.rotation.y = this.globalTilt.curY;

    // 2. Cursor glow fade in/out
    const timeSinceMove = this.clock.getElapsedTime() - this.pointer.lastMoveTime;
    const targetGlow = (this.pointer.isInside && timeSinceMove < 2.5) ? 1.0 : 0.0;
    this.materials.cursorUniforms.uCursorGlow.value +=
      (targetGlow - this.materials.cursorUniforms.uCursorGlow.value) * Math.min(dt * 8.0, 1.0);

    // 3. Piece hover spring dynamics: k=170, c=19
    const keys = ['nav', 'A', 'B', 'C', 'D', 'E'];
    for (const k of keys) {
      const piece = this.piecesState[k];
      const isHovered = (this.hoveredPieceId === k);

      // Target lift: 50*S (nav 32*S)
      const maxLift = (k === 'nav') ? 32.0 * S : 50.0 * S;
      piece.targetZ = isHovered ? maxLift : 0.0;

      // Target tip: up to +-0.24 rad, dipping away from pointer
      if (isHovered && this.pointer.isInside) {
        // Pointer relative to this piece's centroid in world coords
        const dx = this.pointer.worldPos.x - piece.group.position.x;
        const dy = this.pointer.worldPos.y - piece.group.position.y;
        const relX = Math.max(-1.0, Math.min(1.0, dx / (this.sizes.blockW * 0.18)));
        const relY = Math.max(-1.0, Math.min(1.0, dy / (this.sizes.panelH * 0.18)));
        piece.targetRotX = -relY * 0.24;
        piece.targetRotY = relX * 0.24;
      } else {
        piece.targetRotX = 0;
        piece.targetRotY = 0;
      }

      // Spring on Z: F = -k * (x - target) - c * v
      const fz = -this.springK * (piece.z - piece.targetZ) - this.springC * piece.vz;
      piece.vz += fz * dt;
      piece.z += piece.vz * dt;

      // Spring on rotation
      const fRotX = -this.springK * (piece.rotX - piece.targetRotX) - this.springC * piece.vRotX;
      piece.vRotX += fRotX * dt;
      piece.rotX += piece.vRotX * dt;

      const fRotY = -this.springK * (piece.rotY - piece.targetRotY) - this.springC * piece.vRotY;
      piece.vRotY += fRotY * dt;
      piece.rotY += piece.vRotY * dt;

      // Iridescence 0.55 -> 1.0, envMapIntensity 1.0 -> 1.9 on hover
      const targetIrid = isHovered ? 1.0 : 0.55;
      const targetEnv = isHovered ? 1.9 : 1.0;
      piece.material.iridescence += (targetIrid - piece.material.iridescence) * Math.min(dt * 9.0, 1.0);
      piece.material.envMapIntensity += (targetEnv - piece.material.envMapIntensity) * Math.min(dt * 9.0, 1.0);

      // Apply in hero mode
      if (this.viewState === 'hero') {
        piece.group.position.z = piece.homePos.z + piece.z;
        piece.group.rotation.x = piece.rotX;
        piece.group.rotation.y = piece.rotY;
      }
    }

    // 4. "← Back" sliver idle wobble & hover
    if (this.sliverPiece && this.viewState === 'definitions') {
      const t = this.clock.getElapsedTime();
      // Idle wobble: +-0.03-0.04 rad at ~1 Hz
      const wobbleX = Math.sin(t * 2 * Math.PI) * 0.035;
      const wobbleY = Math.cos(t * 2 * Math.PI) * 0.035;

      // Hover tip: up to 0.14 rad toward pointer
      const hoverTip = this.sliverPiece.isHovered ? 0.14 : 0.0;
      this.sliverPiece.group.rotation.x = 0.08 + wobbleX + hoverTip * 0.5;
      this.sliverPiece.group.rotation.y = -0.16 + wobbleY - hoverTip * 0.5;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = this.clock.getElapsedTime();

    // Check hover
    if (this.viewState === 'hero') {
      this.raycastHover();
    }

    // Update physics & springs
    this.updatePhysics(dt);

    // Transitions
    if (this.viewState === 'shattering') {
      const elapsed = now - this.transitionStartTime;
      this.updateShatterAnimation(elapsed);
    } else if (this.viewState === 'reassembling') {
      const elapsed = now - this.transitionStartTime;
      this.updateReassembleAnimation(elapsed);
    }

    // Rebuild live cut pattern breathing geometry at ~45 fps
    if (this.viewState === 'hero' && (now - this.lastGeomRebuildTime >= this.geomRebuildInterval)) {
      this.lastGeomRebuildTime = now;
      this.rebuildShardGeometries(now);
    }

    // Sync DOM homography matrix3d with 3D panel corners
    if (this.viewState === 'hero') {
      this.syncDOMOverlayTransform();
    }

    // Render 3D scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Bootstrap immediately or on DOMContentLoaded
function bootstrap() {
  if (!window.app) {
    window.app = new GlassHeroApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
