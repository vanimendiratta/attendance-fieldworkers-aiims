# Biometric Security Architecture & Liveness (PAD) Assessment

**Authoritative Technical Classification**:
> **NO PRESENTATION ATTACK DETECTION (PAD) / LIVENESS PROTECTION**
> 
> The face recognition feature implemented in this application is a **2D software-based visual convenience heuristic**, not hardware-backed biometric authentication (such as Apple Face ID, Windows Hello, or Android Biometric Class 3).

---

## 1. Pipeline Architecture

The facial verification pipeline operates on a custom 128-dimensional descriptor:
* **Spatial Luminance Features (64 dimensions)**: Mean luminance values computed across an 8×8 grid of 16×16px spatial blocks from a 128×128 grayscale crop.
* **Edge-Gradient Energy (64 dimensions)**: Horizontal and vertical gradient energy ($\Delta x + \Delta y$) computed across the same 8×8 grid.
* **Normalization**: $L_2$ Euclidean unit-vector normalization.
* **Matching**: Cosine similarity against enrolled employee descriptors using an active threshold of $\ge 0.75$ (75.0%).

---

## 2. Experimental Verification Results

Empirical testing performed via `test/biometric_security_evaluation.test.js` yielded the following metrics:

### Genuine Acceptance (Same Enrolled Individual)
| Test Condition | Cosine Similarity | Status |
| :--- | :--- | :--- |
| Normal Lighting (Baseline) | 100.0% | **ACCEPTED** |
| Low Lighting (50% underexposure) | 99.7% | **ACCEPTED** |
| Bright Lighting (140% overexposure) | 99.6% | **ACCEPTED** |
| Background Perturbation (Office to outdoor) | 89.4% | **ACCEPTED** |
| Distance Variation (5% scale shift) | 99.9% | **ACCEPTED** |
| Angle Perturbation (5–10° yaw rotation) | 96.9% | **ACCEPTED** |
| Camera Resolution Downsampling | 97.5% | **ACCEPTED** |
| Eyewear Variation (Wearing glasses) | 98.5% | **ACCEPTED** |
| No Glasses Baseline | 100.0% | **ACCEPTED** |
| Facial Expression (Smile) | 99.7% | **ACCEPTED** |

* **False Rejection Rate (FRR)**: **0.0%** at $\ge 0.75$ threshold.

---

### Impostor Rejection (Different Human Subjects)
| Subject Profile | Cosine Similarity | Status |
| :--- | :--- | :--- |
| Impostor 1 (Inverted facial structure) | 86.6% | **FALSE ACCEPT** |
| Impostor 2 (High forehead, wide chin) | 62.3% | **BLOCKED** |
| Impostor 3 (Asymmetric bone structure) | 80.6% | **FALSE ACCEPT** |
| Impostor 4 (Round face, uniform gradient) | 91.5% | **FALSE ACCEPT** |
| Impostor 5 (Distinct human subject) | 82.9% | **FALSE ACCEPT** |

* **False Acceptance Rate (FAR)**: **80.0%** at $\ge 0.75$ threshold due to coarse 8×8 grid spatial correlation across human facial layouts.

---

### Presentation Attack Detection (PAD) & Spoofing Vulnerabilities
| Attack Vector | Similarity Score | Outcome |
| :--- | :--- | :--- |
| **Printed Color Photograph** | 100.0% | **SPOOF ACCEPTED** |
| **Smartphone Display Replay** | 100.0% | **SPOOF ACCEPTED** |
| **Laptop LCD Display Replay** | 100.0% | **SPOOF ACCEPTED** |
| **Recorded Video Playback** | 100.0% | **SPOOF ACCEPTED** |
| **Direct Screenshot** | 100.0% | **SPOOF ACCEPTED** |
| **High-Resolution Photo Print** | 100.0% | **SPOOF ACCEPTED** |

---

## 3. Biometric Data Privacy & Storage Controls

In strict compliance with modern privacy and data protection standards (GDPR / DPDP):
1. **No Raw Frame Persistence**: Raw video feeds, camera snapshots, or full facial images are **NEVER stored** in the `employees` biometric database.
2. **One-Way Mathematical Vectors**: Only normalized 128-dimensional floating-point vectors are retained.
3. **No Biometric Descriptors in Public APIs**: Employee login, list, profile, and attendance query APIs strip `face_descriptor` and `face_photo` from all JSON responses.
4. **No Descriptors in Browser Storage**: Client `localStorage` stores only employee identity tokens and metadata, never raw biometric vectors.
5. **Permanent Biometric Deletion**: Invoking `DELETE /api/employees/:id` immediately and permanently purges the employee's biometric descriptor and enrollment flags.
6. **Re-Enrollment Safety**: Re-enrolling a face atomically overwrites prior descriptors in an isolated transaction.
