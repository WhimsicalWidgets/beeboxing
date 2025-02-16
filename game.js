import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/PointerLockControls.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(this.renderer.domElement);
    
    // Set clear color to light blue to avoid white flash
    this.renderer.setClearColor(0x87CEEB);
    
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (this.isMobile) {
      // Don't use PointerLockControls for mobile
      this.controls = null;
      this.camera.rotation.order = 'YXZ'; // Ensure proper rotation order
    } else {
      this.controls = new PointerLockControls(this.camera, document.body);
    }
    
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.canJump = true;
    
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    
    this.prevTime = performance.now();
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.lastDelta = 1/60; // Store last good delta for pause/unpause

    this.raycaster = new THREE.Raycaster();
    this.heldCube = null;
    this.cubeHoldDistance = 3;
    
    this.cubes = [];  // Array to store all cubes for physics updates
    this.cubeVelocities = new Map();  // Map to store cube velocities
    
    this.beeBoxes = [];
    this.particles = [];
    this.particleSystems = new Map();
    this.tools = {
      smoker: { active: true, lastUseTime: 0 },
      honeyPot: { active: false, lastUseTime: 0 }
    };
    this.boxingBees = [];  // Array to store boxing bees
    this.lastBeeSpawn = 0; // Track last bee spawn time
    
    // Add score tracking
    this.boxingBeesRepelled = 0;
    this.beeBoxesSmoked = 0;

    this.touchControls = {
      movement: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      moving: false,
      looking: false
    };
    
    if (this.isMobile) {
      // Request device orientation permission for iOS
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then(response => {
            if (response === 'granted') {
              window.addEventListener('deviceorientation', (e) => this.handleDeviceOrientation(e));
            }
          })
          .catch(console.error);
      } else {
        // For Android or devices that don't need permission
        window.addEventListener('deviceorientation', (e) => this.handleDeviceOrientation(e));
      }
      this.initMobileControls();
    }

    this.init();
  }

  init() {
    // Create gradient sky background
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;

    const uniforms = {
      topColor: { value: new THREE.Color(0x71c5ee) },    // Light blue
      bottomColor: { value: new THREE.Color(0xdcf5ff) }, // Very light blue
      offset: { value: 33 },
      exponent: { value: 0.6 }
    };

    const skyGeo = new THREE.SphereGeometry(500, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: uniforms,
      side: THREE.BackSide
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    // Enhanced Lighting with adjusted values
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Increased ambient light
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 3, 2);
    this.scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1, 2, -1);
    this.scene.add(fillLight);

    // Floor with grid texture
    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    
    // Create grid texture with dark green lines
    const gridSize = 200;
    const gridDivisions = 100;
    const gridTexture = new THREE.GridHelper(gridSize, gridDivisions, 0x0a3a0a, 0x0a3a0a);
    gridTexture.material.opacity = 0.4;
    gridTexture.material.transparent = true;
    gridTexture.position.y = 0.01;
    this.scene.add(gridTexture);

    // Floor material with darker grass-like appearance
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x184d18,
      roughness: 0.9,
      metalness: 0.0
    });
    
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Clear existing cubes
    this.cubes = [];
    this.cubeVelocities = new Map();

    // Create bee boxes
    for (let i = 0; i < 30; i++) {
      this.createBeeBox(
        Math.random() * 160 - 80,
        0.5,
        Math.random() * 160 - 80
      );
    }

    this.createTools();

    // Camera initial position
    this.camera.position.y = 2;

    // Event listeners
    document.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('contextmenu', (event) => this.onRightClick(event));
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('resize', () => this.onWindowResize());

    // Create boxing bee geometry and materials
    const beeGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const beeMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    this.beeTemplate = new THREE.Mesh(beeGeometry, beeMaterial);

    // Create boxing glove geometry
    const gloveGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    this.gloveTemplate = new THREE.Mesh(gloveGeometry, gloveMaterial);

    this.startBeeBoxBehaviors();

    // Start animation loop
    this.animate();
  }

  createBeeBox(x, y, z) {
    const boxGeometry = new THREE.BoxGeometry(1.5, 1, 1);
    const boxMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      roughness: 0.8
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(x, y, z);
    box.userData.isHive = true;
    box.userData.state = 'idle';
    box.userData.nextStateChange = performance.now() + Math.random() * 10000;
    this.scene.add(box);
    this.beeBoxes.push(box);
    
    // Create particle system for this box
    const particleSystem = this.createParticleSystem();
    particleSystem.position.copy(box.position);
    this.scene.add(particleSystem);
    this.particleSystems.set(box, particleSystem);
    
    return box;
  }

  createParticleSystem() {
    const particleCount = 100;
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = Math.random() - 0.5;
      positions[i + 1] = Math.random() - 0.5;
      positions[i + 2] = Math.random() - 0.5;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 0.05,
      transparent: true,
      opacity: 0.6
    });
    
    return new THREE.Points(particles, particleMaterial);
  }

  createTools() {
    // Smoker tool
    const smokerGeometry = new THREE.CylinderGeometry(0.1, 0.15, 0.3);
    const smokerMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
    this.smokerTool = new THREE.Mesh(smokerGeometry, smokerMaterial);
    this.smokerTool.userData.originalPosition = new THREE.Vector3(-0.5, -0.2, -0.5);
    this.smokerTool.userData.useAnimation = { active: false, progress: 0 };
    
    // Add smoke particles
    this.smokeParticles = this.createParticleSystem();
    this.smokeParticles.material.color.setHex(0x888888);
    this.smokeParticles.material.size = 0.03;
    this.smokeParticles.visible = false;
    this.scene.add(this.smokeParticles);
    
    // Honey pot tool
    const potGeometry = new THREE.CylinderGeometry(0.15, 0.1, 0.25);
    const potMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
    this.honeyPotTool = new THREE.Mesh(potGeometry, potMaterial);
    this.honeyPotTool.userData.originalPosition = new THREE.Vector3(0.5, -0.2, -0.5);
    this.honeyPotTool.userData.useAnimation = { active: false, progress: 0 };
    
    // Add honey drip particles
    this.honeyParticles = this.createParticleSystem();
    this.honeyParticles.material.color.setHex(0xffd700);
    this.honeyParticles.material.size = 0.02;
    this.honeyParticles.visible = false;
    this.scene.add(this.honeyParticles);
    
    // Initial tool states
    this.tools = {
      smoker: { active: true, lastUseTime: 0 },
      honeyPot: { active: false, lastUseTime: 0 }
    };
    
    // Position tools
    this.updateToolPosition();
  }

  updateToolPosition() {
    // Get camera quaternion for rotation
    const quaternion = this.camera.quaternion;
    
    // Update smoker position and rotation
    const smokerOffset = this.smokerTool.userData.originalPosition.clone();
    if (this.smokerTool.userData.useAnimation.active) {
      const progress = this.smokerTool.userData.useAnimation.progress;
      smokerOffset.z += Math.sin(progress * Math.PI) * 0.2; // Move forward during use
      smokerOffset.y += Math.sin(progress * Math.PI * 2) * 0.05; // Slight up/down motion
    }
    
    smokerOffset.applyQuaternion(quaternion);
    this.smokerTool.position.copy(this.camera.position).add(smokerOffset);
    this.smokerTool.quaternion.copy(quaternion);
    this.scene.add(this.smokerTool);
    
    // Update smoke particles position
    this.smokeParticles.position.copy(this.smokerTool.position)
      .add(new THREE.Vector3(0, 0.2, 0).applyQuaternion(quaternion));
    
    // Update honey pot position and rotation
    const potOffset = this.honeyPotTool.userData.originalPosition.clone();
    if (this.honeyPotTool.userData.useAnimation.active) {
      const progress = this.honeyPotTool.userData.useAnimation.progress;
      potOffset.z += Math.sin(progress * Math.PI) * 0.2; // Move forward during use
      potOffset.y -= Math.sin(progress * Math.PI * 2) * 0.05; // Slight up/down motion
    }
    
    potOffset.applyQuaternion(quaternion);
    this.honeyPotTool.position.copy(this.camera.position).add(potOffset);
    this.honeyPotTool.quaternion.copy(quaternion);
    this.scene.add(this.honeyPotTool);
    
    // Update honey particles position
    this.honeyParticles.position.copy(this.honeyPotTool.position)
      .add(new THREE.Vector3(0, -0.2, 0).applyQuaternion(quaternion));
  }

  onClick(event) {
    if (!this.isMobile && !this.controls.isLocked) {
      this.controls.lock();
      return;
    }

    // Use smoker tool
    if (this.tools.smoker.active) {
      this.tools.smoker.lastUseTime = performance.now();
      this.smokeParticles.visible = true;
      this.smokerTool.userData.useAnimation = { active: true, progress: 0 };
      
      // Check for bee hits
      const center = new THREE.Vector2();
      this.raycaster.setFromCamera(center, this.camera);
      const intersects = this.raycaster.intersectObjects(this.boxingBees);
      
      if (intersects.length > 0) {
        const bee = intersects[0].object;
        bee.userData.hit = true;
        this.boxingBeesRepelled++; // Increment score
      }

      setTimeout(() => {
        this.smokeParticles.visible = false;
        this.smokerTool.userData.useAnimation.active = false;
      }, 1000);

      const center2 = new THREE.Vector2();
      this.raycaster.setFromCamera(center2, this.camera);
      const intersects2 = this.raycaster.intersectObjects(this.beeBoxes);
      
      if (intersects2.length > 0) {
        const box = intersects2[0].object;
        if (box.userData.state === 'swarming') {
          box.userData.state = 'idle';
          box.userData.nextStateChange = performance.now() + Math.random() * 10000;
          box.material.color.setHex(0x8B4513);
          this.beeBoxesSmoked++; // Increment score
        }
      }
    }
  }

  onRightClick(event) {
    event.preventDefault();
    if (!this.controls.isLocked) return;

    // Use honey pot tool
    if (this.tools.honeyPot.active) {
      this.tools.honeyPot.lastUseTime = performance.now();
      this.honeyParticles.visible = true;
      this.honeyPotTool.userData.useAnimation = { active: true, progress: 0 };
      setTimeout(() => {
        this.honeyParticles.visible = false;
        this.honeyPotTool.userData.useAnimation.active = false;
      }, 1000);

      const center = new THREE.Vector2();
      this.raycaster.setFromCamera(center, this.camera);
      const intersects = this.raycaster.intersectObjects(this.beeBoxes);
      
      if (intersects.length > 0) {
        const box = intersects[0].object;
        if (box.userData.state === 'leaking') {
          box.userData.state = 'idle';
          box.userData.nextStateChange = performance.now() + Math.random() * 10000;
          box.material.color.setHex(0x8B4513);
        }
      }
    }
  }

  onKeyDown(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = true;
        break;
      case 'Space':
        if (this.canJump) {
          this.velocity.y += 20;
          this.canJump = false;
        }
        break;
      case 'Digit1':
        this.tools.smoker.active = true;
        this.tools.honeyPot.active = false;
        break;
      case 'Digit2':
        this.tools.smoker.active = false;
        this.tools.honeyPot.active = true;
        break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = false;
        break;
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updatePosition() {
    const pos = this.camera.position;
    document.getElementById('position').textContent = 
      `X: ${pos.x.toFixed(2)} Y: ${pos.y.toFixed(2)} Z: ${pos.z.toFixed(2)}`;
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate > 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      document.getElementById('fps').textContent = fps;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  updateHeldCube() {
    if (this.heldCube) {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      const targetPosition = this.camera.position.clone()
        .add(direction.multiplyScalar(this.cubeHoldDistance));
      
      this.heldCube.position.lerp(targetPosition, 0.1);
    }
  }

  updateCubePhysics(delta) {
    const gravity = -9.8;
    const damping = 0.3; 
    const friction = 0.8; 
    const groundFriction = 0.7; 

    for (const cube of this.cubes) {
      if (cube.userData.isHeld) continue;

      const velocity = this.cubeVelocities.get(cube);
      
      // Apply gravity
      velocity.y += gravity * delta;
      
      // Update position
      cube.position.x += velocity.x * delta;
      cube.position.y += velocity.y * delta;
      cube.position.z += velocity.z * delta;
      
      // Floor collision with more friction
      if (cube.position.y < 0.5) {
        cube.position.y = 0.5;
        if (velocity.y < 0) {
          velocity.y = -velocity.y * damping;
          // Apply stronger ground friction
          velocity.x *= groundFriction;
          velocity.z *= groundFriction;
        }
      }
      
      // Cube collision with more friction
      for (const otherCube of this.cubes) {
        if (cube === otherCube) continue;
        
        const distance = cube.position.distanceTo(otherCube.position);
        if (distance < 1) {
          const normal = cube.position.clone().sub(otherCube.position).normalize();
          cube.position.add(normal.multiplyScalar(1 - distance));
          
          const dot = velocity.dot(normal);
          if (dot < 0) {
            velocity.sub(normal.multiplyScalar(2 * dot));
            velocity.multiplyScalar(damping);
            // Apply friction to lateral movement during collision
            const lateralVelocity = velocity.clone().sub(normal.multiplyScalar(velocity.dot(normal)));
            lateralVelocity.multiplyScalar(friction);
            velocity.copy(lateralVelocity.add(normal.multiplyScalar(velocity.dot(normal))));
          }
        }
      }
      
      // Additional velocity dampening for more stable stacking
      if (Math.abs(velocity.y) < 0.1 && cube.position.y <= 0.51) {
        velocity.x *= 0.92; 
        velocity.z *= 0.92;
      }
    }
  }

  updateParticleSystems(delta) {
    this.beeBoxes.forEach(box => {
      const particleSystem = this.particleSystems.get(box);
      if (box.userData.state !== 'idle') {
        particleSystem.visible = true;
        const positions = particleSystem.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] += (Math.random() - 0.5) * delta;
          positions[i + 1] += (Math.random() - 0.5) * delta;
          positions[i + 2] += (Math.random() - 0.5) * delta;
          
          if (Math.abs(positions[i]) > 1) positions[i] = Math.random() - 0.5;
          if (Math.abs(positions[i + 1]) > 1) positions[i + 1] = Math.random() - 0.5;
          if (Math.abs(positions[i + 2]) > 1) positions[i + 2] = Math.random() - 0.5;
        }
        
        particleSystem.geometry.attributes.position.needsUpdate = true;
        
        if (box.userData.state === 'swarming') {
          particleSystem.material.color.setHex(0xffff00);
        } else {
          particleSystem.material.color.setHex(0xffd700);
        }
      } else {
        particleSystem.visible = false;
      }
    });

    // Update tool particles
    if (this.smokeParticles.visible) {
      const positions = this.smokeParticles.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += (Math.random() - 0.5) * delta;
        positions[i + 1] += Math.random() * delta * 2;
        positions[i + 2] += (Math.random() - 0.5) * delta;
      }
      this.smokeParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (this.honeyParticles.visible) {
      const positions = this.honeyParticles.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += (Math.random() - 0.5) * delta * 0.5;
        positions[i + 1] -= Math.random() * delta * 2;
        positions[i + 2] += (Math.random() - 0.5) * delta * 0.5;
      }
      this.honeyParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  spawnBoxingBee() {
    const bee = this.beeTemplate.clone();
    
    // Random position around the player
    const angle = Math.random() * Math.PI * 2;
    const distance = 20;
    bee.position.set(
      this.camera.position.x + Math.cos(angle) * distance,
      this.camera.position.y,
      this.camera.position.z + Math.sin(angle) * distance
    );

    // Add boxing gloves
    const leftGlove = this.gloveTemplate.clone();
    const rightGlove = this.gloveTemplate.clone();
    leftGlove.position.set(-0.4, 0, 0);
    rightGlove.position.set(0.4, 0, 0);
    bee.add(leftGlove);
    bee.add(rightGlove);

    // Reduced speed range from (5-7) to (2.5-3.5)
    bee.userData.speed = 2.5 + Math.random() * 1;
    bee.userData.wobble = Math.random() * Math.PI * 2;
    bee.userData.hit = false;

    this.scene.add(bee);
    this.boxingBees.push(bee);
  }

  updateBoxingBees(delta) {
    // Spawn new bee every 3 seconds
    if (performance.now() - this.lastBeeSpawn > 3000) {  
      this.spawnBoxingBee();
      this.lastBeeSpawn = performance.now();
    }

    const playerRadius = 1; // Player collision radius
    const beeRadius = 0.3; // Bee collision radius
    const playerPos = this.camera.position.clone();

    // Update existing bees
    for (let i = this.boxingBees.length - 1; i >= 0; i--) {
      const bee = this.boxingBees[i];
      
      if (bee.userData.hit) {
        // Move bee backwards and up when hit
        const direction = bee.position.clone().sub(this.camera.position).normalize();
        bee.position.add(direction.multiplyScalar(15 * delta));
        bee.position.y += 5 * delta;
        
        // Remove bee if it's far enough away
        if (bee.position.distanceTo(this.camera.position) > 30) {
          this.scene.remove(bee);
          this.boxingBees.splice(i, 1);
        }
      } else {
        // Calculate direction to player before moving
        const directionToPlayer = this.camera.position.clone().sub(bee.position).normalize();
        const newPosition = bee.position.clone().add(directionToPlayer.multiplyScalar(bee.userData.speed * delta));
        
        // Check distance to player after potential movement
        const distanceToPlayer = newPosition.distanceTo(playerPos);
        
        // Only move if not colliding with player
        if (distanceToPlayer > (playerRadius + beeRadius)) {
          bee.position.copy(newPosition);
        } else {
          // If would collide, stop at the collision point
          const collisionPoint = bee.position.clone().add(
            directionToPlayer.multiplyScalar(distanceToPlayer - (playerRadius + beeRadius))
          );
          bee.position.copy(collisionPoint);
        }
        
        // Wobble motion
        bee.userData.wobble += delta * 5;
        bee.position.y += Math.sin(bee.userData.wobble) * delta;
        
        // Rotate boxing gloves
        bee.children.forEach((glove, index) => {
          glove.rotation.z = Math.sin(bee.userData.wobble + (index * Math.PI)) * 0.5;
        });
      }

      // Check collisions with other bees
      for (let j = i + 1; j < this.boxingBees.length; j++) {
        const otherBee = this.boxingBees[j];
        const distance = bee.position.distanceTo(otherBee.position);
        
        if (distance < beeRadius * 2) {
          // Push bees apart
          const pushDirection = bee.position.clone().sub(otherBee.position).normalize();
          const pushAmount = (beeRadius * 2 - distance) / 2;
          
          bee.position.add(pushDirection.multiplyScalar(pushAmount));
          otherBee.position.add(pushDirection.multiplyScalar(-pushAmount));
        }
      }
    }
  }

  initMobileControls() {
    const movementPad = document.getElementById('movement-pad');
    const movementStick = document.getElementById('movement-stick');
    const lookPad = document.getElementById('look-pad');
    const toolButtons = document.getElementById('tool-buttons');

    let lastTouchX = 0;
    let lastTouchY = 0;

    // Movement controls
    movementPad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchControls.moving = true;
      this.updateMovementStick(e.touches[0], movementPad, movementStick);
    });

    // Camera look control for entire screen
    document.addEventListener('touchstart', (e) => {
      const element = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      if (element === movementPad || element === movementStick || element.classList.contains('tool-button')) {
        return;
      }
      
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      this.touchControls.looking = true;

      // Check for interaction with bee boxes or bees
      const touchX = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
      const touchY = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(new THREE.Vector2(touchX, touchY), this.camera);
      
      const intersectsBees = this.raycaster.intersectObjects(this.boxingBees);
      const intersectsBoxes = this.raycaster.intersectObjects(this.beeBoxes);
      
      if (intersectsBees.length > 0 && this.tools.smoker.active) {
        this.onClick(e);
      } else if (intersectsBoxes.length > 0) {
        if (this.tools.smoker.active) {
          this.onClick(e);
        } else if (this.tools.honeyPot.active) {
          this.onRightClick(e);
        }
      }
    });

    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let touch of e.touches) {
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        if (element === movementPad || element === movementStick) {
          this.updateMovementStick(touch, movementPad, movementStick);
        } else {
          // Camera look control - modified for simpler rotation with doubled sensitivity
          const deltaX = touch.clientX - lastTouchX;
          const deltaY = touch.clientY - lastTouchY;
          
          // Camera rotation with better handling
          if (this.touchControls.looking) {
            // Doubled sensitivity for camera movement
            this.camera.rotation.y -= deltaX * 0.002;
            // Clamp vertical rotation
            const newRotationX = this.camera.rotation.x - deltaY * 0.002;
            this.camera.rotation.x = Math.max(-Math.PI/3, Math.min(Math.PI/3, newRotationX));
            
            // Ensure camera stays level by forcing rotation.z to 0
            this.camera.rotation.z = 0;
          }
          
          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
        }
      }
    });

    document.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        this.touchControls.moving = false;
        this.touchControls.looking = false;
        movementStick.style.left = '40px';
        movementStick.style.top = '40px';
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
      }
    });

    // Mouse/touch event handlers for mobile devices
    document.addEventListener('mousedown', (e) => {
      const element = document.elementFromPoint(e.clientX, e.clientY);
      if (element === movementPad || element === movementStick || element.classList.contains('tool-button')) {
        return;
      }
      
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
      this.touchControls.looking = true;
    });

    document.addEventListener('mousemove', (e) => {
      if (this.touchControls.looking) {
        const deltaX = e.clientX - lastTouchX;
        const deltaY = e.clientY - lastTouchY;
        
        // Camera rotation with mouse
        this.camera.rotation.y -= deltaX * 0.004;
        const newRotationX = this.camera.rotation.x - deltaY * 0.004;
        this.camera.rotation.x = Math.max(-Math.PI/3, Math.min(Math.PI/3, newRotationX));
        
        // Keep camera level
        this.camera.rotation.z = 0;
        
        lastTouchX = e.clientX;
        lastTouchY = e.clientY;
      }
    });

    document.addEventListener('mouseup', () => {
      this.touchControls.looking = false;
    });

    // Tool selection
    toolButtons.addEventListener('click', (e) => {
      if (e.target.classList.contains('tool-button')) {
        const tool = e.target.dataset.tool;
        document.querySelectorAll('.tool-button').forEach(btn => {
          btn.classList.remove('active-tool');
        });
        e.target.classList.add('active-tool');
        if (tool === '1') {
          this.tools.smoker.active = true;
          this.tools.honeyPot.active = false;
        } else if (tool === '2') {
          this.tools.smoker.active = false;
          this.tools.honeyPot.active = true;
        }
      }
    });
  }

  updateMovementStick(touch, pad, stick) {
    const padRect = pad.getBoundingClientRect();
    const centerX = padRect.left + padRect.width / 2;
    const centerY = padRect.top + padRect.height / 2;
    
    let deltaX = touch.clientX - centerX;
    let deltaY = touch.clientY - centerY;
    
    const distance = Math.min(40, Math.sqrt(deltaX * deltaX + deltaY * deltaY));
    const angle = Math.atan2(deltaY, deltaX);
    
    const stickX = Math.cos(angle) * distance;
    const stickY = Math.sin(angle) * distance;
    
    stick.style.left = `${40 + stickX}px`;
    stick.style.top = `${40 + stickY}px`;
    
    // Reduce movement sensitivity to 1/4 for mobile
    this.touchControls.movement.x = (stickX / 40) * 0.25;
    this.touchControls.movement.y = -(stickY / 40) * 0.25; // Reversed Y movement
    
    // Reversed forward/backward controls
    this.moveForward = stickY > 0.3;
    this.moveBackward = stickY < -0.3;
    this.moveLeft = stickX < -0.3;
    this.moveRight = stickX > 0.3;
  }

  handleDeviceOrientation(event) {
    if (!this.isMobile) return;
    
    // Beta is front-to-back tilt in degrees, ranging from -180 to 180
    // Gamma is left-to-right tilt in degrees, ranging from -90 to 90
    const beta = event.beta;  // X-axis rotation
    const gamma = event.gamma; // Y-axis rotation
    
    if (beta !== null && gamma !== null) {
      // Convert degrees to radians and apply to camera rotation
      // Limit vertical rotation to prevent flipping
      const newRotationX = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(beta - 45, -45, 45));
      this.camera.rotation.x = -newRotationX * 2;
      
      // Horizontal rotation
      this.camera.rotation.y = THREE.MathUtils.degToRad(-gamma * 2);
      
      // Keep camera level by forcing rotation.z to 0
      this.camera.rotation.z = 0;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const isActive = this.isMobile || (this.controls && this.controls.isLocked);
    
    if (isActive) {
      const time = performance.now();
      let delta = (time - this.prevTime) / 1000;
      
      // Prevent huge physics steps after unpause
      if (delta > 0.1) {
        delta = this.lastDelta;
      }
      this.lastDelta = delta;

      this.velocity.x -= this.velocity.x * 10.0 * delta;
      this.velocity.z -= this.velocity.z * 10.0 * delta;
      this.velocity.y -= 9.8 * 10.0 * delta;

      this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
      this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
      this.direction.normalize();

      if (this.moveForward || this.moveBackward) {
        this.velocity.z -= this.direction.z * 400.0 * delta;
      }
      if (this.moveLeft || this.moveRight) {
        this.velocity.x -= this.direction.x * 400.0 * delta;
      }

      if (this.isMobile) {
        // For mobile, apply movement relative to camera rotation
        const moveX = -this.velocity.x * delta;
        const moveZ = -this.velocity.z * delta;
        const angle = this.camera.rotation.y;
        this.camera.position.x += Math.sin(angle) * moveZ + Math.cos(angle) * moveX;
        this.camera.position.z += Math.cos(angle) * moveZ - Math.sin(angle) * moveX;
      } else {
        this.controls.moveRight(-this.velocity.x * delta);
        this.controls.moveForward(-this.velocity.z * delta);
      }

      this.camera.position.y += this.velocity.y * delta;

      if (this.camera.position.y < 2) {
        this.velocity.y = 0;
        this.camera.position.y = 2;
        this.canJump = true;
      }

      // Update tool animations
      if (this.smokerTool.userData.useAnimation.active) {
        this.smokerTool.userData.useAnimation.progress += delta;
      }
      if (this.honeyPotTool.userData.useAnimation.active) {
        this.honeyPotTool.userData.useAnimation.progress += delta;
      }

      // Update cube physics with capped delta
      this.updateCubePhysics(Math.min(delta, 0.1));

      this.updatePosition();
      this.updateScores(); // Add score update
      this.updateHeldCube();
      this.prevTime = time;
    } else {
      // When paused, just update the previous time without processing physics
      this.prevTime = performance.now();
    }

    if (isActive && this.isMobile) {
      if (this.touchControls.looking) {
        // Look controls are handled in updateLookControls
      }
    }
    
    this.updateFPS();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateParticleSystems(Math.min(this.lastDelta, 0.1));
    this.updateToolPosition();
    this.updateBoxingBees(Math.min(this.lastDelta, 0.1));
    this.renderer.render(this.scene, this.camera);
  }

  updateScores() {
    document.getElementById('score-bees').textContent = `Boxing Bees: ${this.boxingBeesRepelled}`;
    document.getElementById('score-boxes').textContent = `Bee Boxes: ${this.beeBoxesSmoked}`;
  }

  startBeeBoxBehaviors() {
    setInterval(() => {
      this.beeBoxes.forEach(box => {
        if (performance.now() > box.userData.nextStateChange) {
          if (box.userData.state === 'idle') {
            box.userData.state = Math.random() < 0.5 ? 'swarming' : 'leaking';
            box.userData.nextStateChange = performance.now() + 15000;
            
            if (box.userData.state === 'swarming') {
              box.material.color.setHex(0xff0000);
            } else {
              box.material.color.setHex(0xffaa00);
            }
          }
        }
      });
    }, 1000);
  }
}

// Start the game
const game = new Game();