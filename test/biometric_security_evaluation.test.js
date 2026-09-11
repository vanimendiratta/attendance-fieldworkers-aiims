/**
 * Biometric Security Reassessment & Presentation Attack (PAD) Testing Suite
 *
 * Evaluates the 128-dimensional spatial luminance + edge-gradient biometric pipeline:
 * 1. Genuine Acceptance under realistic environmental perturbations
 * 2. Impostor Rejection across multiple distinct identities (FAR/FRR)
 * 3. Presentation Attack Testing (photo print, phone display, laptop display, video replay, screenshot)
 */

const assert = require('assert');
const biometricService = require('../src/services/biometric_service');

// Helper to construct a normalized 128-d descriptor from 64 spatial luminance and 64 gradient values
function buildDescriptor(luminanceMap, gradientMap) {
  const vector = [];
  for (let i = 0; i < 64; i++) {
    vector.push(luminanceMap[i] || 0);
    vector.push(gradientMap[i] || 0);
  }
  // L2 normalize
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vector.map(v => Number((v / norm).toFixed(5)));
}

// Generate base enrolled face pattern (simulating facial structure: forehead, eyes, nose, mouth)
function createBaseFace() {
  const lum = new Float32Array(64);
  const grad = new Float32Array(64);

  // 8x8 grid: y=0..7, x=0..7
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = y * 8 + x;
      // Forehead (y=1..2): moderate lum, low grad
      if (y >= 1 && y <= 2) {
        lum[idx] = 0.65;
        grad[idx] = 0.15;
      }
      // Eyes (y=2..3, x=2,5): darker lum, high horizontal gradient
      else if ((y === 2 || y === 3) && (x === 2 || x === 5)) {
        lum[idx] = 0.35;
        grad[idx] = 0.75;
      }
      // Nose bridge (y=3..4, x=3..4): high lum, vertical gradient
      else if ((y === 3 || y === 4) && (x === 3 || x === 4)) {
        lum[idx] = 0.78;
        grad[idx] = 0.55;
      }
      // Cheeks (y=4..5, x=1,6): smooth lum
      else if ((y === 4 || y === 5) && (x === 1 || x === 6)) {
        lum[idx] = 0.62;
        grad[idx] = 0.20;
      }
      // Mouth (y=5..6, x=3..4): darker lum, horizontal gradient
      else if ((y === 5 || y === 6) && (x === 3 || x === 4)) {
        lum[idx] = 0.40;
        grad[idx] = 0.68;
      }
      // Chin (y=6..7): taper
      else if (y >= 6) {
        lum[idx] = 0.55;
        grad[idx] = 0.30;
      }
      // Background / hair edges
      else {
        lum[idx] = 0.25;
        grad[idx] = 0.40;
      }
    }
  }

  return { lum, grad };
}

async function runBiometricSecurityAudit() {
  console.log('===============================================================');
  console.log('🔬 BIOMETRIC SECURITY REASSESSMENT & LIVENESS (PAD) TEST SUITE');
  console.log('===============================================================');

  const base = createBaseFace();
  const enrolledDescriptor = buildDescriptor(base.lum, base.grad);
  const THRESHOLD = biometricService.MATCH_THRESHOLD; // 0.75

  console.log(`\nBiometric Architecture: 128-D Spatial Luminance + Gradient Histogram`);
  console.log(`Matching Metric: Cosine Similarity | Active Threshold: >= ${THRESHOLD} (75.0%)`);
  console.log(`Classification Note: 2D software vision heuristic. Not hardware-backed Apple Face ID.\n`);

  // -------------------------------------------------------------
  // Section 1: Genuine Acceptance Testing
  // -------------------------------------------------------------
  console.log('--- [Section 1] Genuine Acceptance Testing (Same Enrolled Subject) ---');
  
  const genuineTests = [
    {
      condition: 'Normal Lighting (Baseline)',
      transform: (l, g) => ({ l: Float32Array.from(l), g: Float32Array.from(g) })
    },
    {
      condition: 'Low Lighting (Underexposed ~50%)',
      transform: (l, g) => ({
        l: l.map(v => Math.max(0.05, v * 0.6)),
        g: g.map(v => v * 0.7)
      })
    },
    {
      condition: 'Bright Lighting (Overexposed ~140%)',
      transform: (l, g) => ({
        l: l.map(v => Math.min(1.0, v * 1.35)),
        g: g.map(v => v * 1.1)
      })
    },
    {
      condition: 'Different Background (Office wall to outdoor)',
      transform: (l, g) => {
        const nl = Float32Array.from(l);
        const ng = Float32Array.from(g);
        // Perturb background perimeter (y=0, y=7, x=0, x=7)
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            if (y === 0 || y === 7 || x === 0 || x === 7) {
              nl[y * 8 + x] = 0.85; // bright wall
              ng[y * 8 + x] = 0.10;
            }
          }
        }
        return { l: nl, g: ng };
      }
    },
    {
      condition: 'Slightly Different Distance (5% scale shift)',
      transform: (l, g) => ({
        l: l.map((v, i) => v * (1 + 0.05 * Math.sin(i))),
        g: g.map((v, i) => v * (1 + 0.05 * Math.cos(i)))
      })
    },
    {
      condition: 'Different Face Angle (5-10° yaw rotation)',
      transform: (l, g) => {
        const nl = Float32Array.from(l);
        const ng = Float32Array.from(g);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const shiftX = Math.min(7, Math.max(0, x + (y % 2 === 0 ? 1 : 0)));
            nl[y * 8 + x] = l[y * 8 + shiftX];
            ng[y * 8 + x] = g[y * 8 + shiftX];
          }
        }
        return { l: nl, g: ng };
      }
    },
    {
      condition: 'Different Camera Resolution (Bilinear downsampling/blur)',
      transform: (l, g) => ({
        l: l.map((v, i) => (v + (l[(i + 1) % 64] || v) + (l[(i + 8) % 64] || v)) / 3),
        g: g.map((v, i) => (v + (g[(i + 1) % 64] || v)) / 2)
      })
    },
    {
      condition: 'Wearing Glasses (Eyewear edge frame artifact)',
      transform: (l, g) => {
        const nl = Float32Array.from(l);
        const ng = Float32Array.from(g);
        // Eyeglass bridge and rims in blocks [2,2], [2,3], [2,4], [2,5]
        [18, 19, 20, 21].forEach(idx => {
          nl[idx] = Math.max(0.1, nl[idx] - 0.2);
          ng[idx] = Math.min(1.0, ng[idx] + 0.4);
        });
        return { l: nl, g: ng };
      }
    },
    {
      condition: 'No Glasses (Clean baseline match)',
      transform: (l, g) => ({ l: Float32Array.from(l), g: Float32Array.from(g) })
    },
    {
      condition: 'Different Facial Expression (Smiling mouth curvature)',
      transform: (l, g) => {
        const nl = Float32Array.from(l);
        const ng = Float32Array.from(g);
        [43, 44, 51, 52].forEach(idx => {
          nl[idx] = nl[idx] * 0.9;
          ng[idx] = Math.min(1.0, ng[idx] * 1.3);
        });
        return { l: nl, g: ng };
      }
    }
  ];

  let genuineRejections = 0;
  genuineTests.forEach(test => {
    const perturbed = test.transform(base.lum, base.grad);
    const candidateDesc = buildDescriptor(perturbed.l, perturbed.g);
    const score = biometricService.computeCosineSimilarity(enrolledDescriptor, candidateDesc);
    const accepted = score >= THRESHOLD;
    if (!accepted) genuineRejections++;

    console.log(
      `  Condition: ${test.condition.padEnd(46)} | Score: ${(score * 100).toFixed(1)}% | ${accepted ? '✓ ACCEPTED' : '❌ REJECTED'}`
    );
  });

  const frr = (genuineRejections / genuineTests.length) * 100;
  console.log(`\nGenuine Acceptance Summary: ${genuineTests.length - genuineRejections}/${genuineTests.length} accepted.`);
  console.log(`False Rejection Rate (FRR) at threshold >= 0.75: ${frr.toFixed(1)}%\n`);

  // -------------------------------------------------------------
  // Section 2: Impostor Rejection Testing
  // -------------------------------------------------------------
  console.log('--- [Section 2] Impostor Rejection Testing (Different Persons) ---');

  const impostorProfiles = [
    {
      name: 'Impostor 1 (Inverted facial structure / narrow face)',
      generator: () => {
        const l = new Float32Array(64).fill(0.4);
        const g = new Float32Array(64).fill(0.3);
        for (let i = 0; i < 64; i += 2) { l[i] = 0.8; g[i] = 0.7; }
        return { l, g };
      }
    },
    {
      name: 'Impostor 2 (High forehead, wide chin, low contrast)',
      generator: () => {
        const l = new Float32Array(64).map((_, i) => 0.3 + 0.4 * Math.sin(i * 0.5));
        const g = new Float32Array(64).map((_, i) => 0.2 + 0.3 * Math.cos(i * 0.3));
        return { l, g };
      }
    },
    {
      name: 'Impostor 3 (Asymmetric bone structure / beard shadow)',
      generator: () => {
        const l = new Float32Array(64).map((_, i) => (i % 8 < 4 ? 0.7 : 0.25));
        const g = new Float32Array(64).map((_, i) => (i > 32 ? 0.8 : 0.15));
        return { l, g };
      }
    },
    {
      name: 'Impostor 4 (Round face, uniform gradient profile)',
      generator: () => {
        const l = new Float32Array(64).map((_, i) => 0.5 + 0.2 * Math.cos(i * 0.9));
        const g = new Float32Array(64).fill(0.35);
        return { l, g };
      }
    },
    {
      name: 'Impostor 5 (Distinct human subject / different ethnicity & bone layout)',
      generator: () => {
        const l = new Float32Array(64).map((_, i) => 0.2 + (i % 5) * 0.15);
        const g = new Float32Array(64).map((_, i) => 0.1 + ((i * 3) % 7) * 0.12);
        return { l, g };
      }
    }
  ];

  let falseAcceptances = 0;
  impostorProfiles.forEach(imp => {
    const data = imp.generator();
    const impDesc = buildDescriptor(data.l, data.g);
    const score = biometricService.computeCosineSimilarity(enrolledDescriptor, impDesc);
    const accepted = score >= THRESHOLD;
    if (accepted) falseAcceptances++;

    console.log(
      `  Subject: ${imp.name.padEnd(48)} | Score: ${(score * 100).toFixed(1)}% | ${accepted ? '⚠️ FALSE ACCEPT' : '✓ REJECTED'}`
    );
  });

  const far = (falseAcceptances / impostorProfiles.length) * 100;
  console.log(`\nImpostor Rejection Summary: ${impostorProfiles.length - falseAcceptances}/${impostorProfiles.length} successfully blocked.`);
  console.log(`False Acceptance Rate (FAR) at threshold >= 0.75: ${far.toFixed(1)}%\n`);

  // -------------------------------------------------------------
  // Section 3: Presentation Attack (Spoofing) Testing
  // -------------------------------------------------------------
  console.log('--- [Section 3] Presentation Attack (Liveness / Spoofing) Testing ---');

  const attackScenarios = [
    {
      attackType: 'Printed Photograph (Color paper print held before webcam)',
      simulate: (l, g) => ({
        // Paper surface reflects flat 2D luminance with slight paper matte gamma
        l: l.map(v => Math.pow(v, 1.05)),
        g: g.map(v => v * 0.96)
      })
    },
    {
      attackType: 'Photograph displayed on another phone (OLED screen replay)',
      simulate: (l, g) => ({
        // Phone screen emits 2D luminance with slight OLED contrast expansion
        l: l.map(v => Math.pow(v, 0.95)),
        g: g.map(v => v * 1.02)
      })
    },
    {
      attackType: 'Photograph displayed on laptop (LCD monitor presentation)',
      simulate: (l, g) => ({
        // LCD monitor backlight with uniform color temperature
        l: l.map(v => v * 0.98 + 0.01),
        g: g.map(v => v * 0.98)
      })
    },
    {
      attackType: 'Recorded Video playback (Replay of genuine face speaking)',
      simulate: (l, g) => ({
        // Temporal frame from video matching enrolled face
        l: l.map((v, i) => v * (1 + 0.02 * Math.sin(i))),
        g: g.map(v => v * 0.99)
      })
    },
    {
      attackType: 'Screenshot (Direct captured frame of enrolled face)',
      simulate: (l, g) => ({
        // Exact digital replication
        l: Float32Array.from(l),
        g: Float32Array.from(g)
      })
    },
    {
      attackType: 'High-Resolution Image (Digital print downscaled to canvas)',
      simulate: (l, g) => ({
        l: l.map(v => v * 0.99),
        g: g.map(v => v * 1.01)
      })
    }
  ];

  let attackVulnerabilities = 0;
  attackScenarios.forEach(att => {
    const spoofedData = att.simulate(base.lum, base.grad);
    const spoofDesc = buildDescriptor(spoofedData.l, spoofedData.g);
    const score = biometricService.computeCosineSimilarity(enrolledDescriptor, spoofDesc);
    const passed = score >= THRESHOLD;
    if (passed) attackVulnerabilities++;

    console.log(
      `  Attack Vector: ${att.attackType.padEnd(52)} | Score: ${(score * 100).toFixed(1)}% | ${passed ? '❌ SPOOF ACCEPTED' : '✓ SPOOF BLOCKED'}`
    );
  });

  console.log(`\nPresentation Attack Summary: ${attackVulnerabilities}/${attackScenarios.length} 2D presentation attacks accepted.`);
  console.log('--------------------------------------------------------------------------------');
  console.log('CRITICAL SECURITY CLASSIFICATION:');
  console.log('>>> [ No Presentation Attack Detection / Liveness Protection ] <<<');
  console.log('Because spatial luminance and edge-gradient descriptors process only 2D pixel energy');
  console.log('without 3D structured light, IR depth, or challenge-response blink/head turn liveness,');
  console.log('a static photo or screen replay of an enrolled employee achieves > 85% similarity.');
  console.log('This system MUST NOT be advertised or relied upon as anti-spoofing biometrics.');
  console.log('--------------------------------------------------------------------------------\n');

  assert.ok(
    attackVulnerabilities >= 4,
    'Presentation attack test confirms lack of active liveness detection (PAD).'
  );
  console.log('✓ Biometric experimental test suite executed successfully with documented classification.');
}

runBiometricSecurityAudit().catch(err => {
  console.error('Biometric test failure:', err);
  process.exit(1);
});
