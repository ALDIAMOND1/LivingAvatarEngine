# Photorealistic Avatar Asset Production

## Inputs and consent
Choose an **original synthetic portrait** or a **user-authorized** portrait. Do not use the Nuance presenter screenshot as the production source. For a real person's likeness, record appropriate permission. Keep uploads private, and do not publish photos or API credentials.

## Reference image specification
- Approximately 1024px or larger across the face; high-quality sharp details, no text/UI/overlay.
- Front or three-quarter frontal, neutral facial expression, teeth not required visible.
- Eyes clearly visible, stable lighting, shoulder framing, neutral background.
- Optionally capture permitted additional head-angle views or a short real video to improve reconstruction.

## Offline preparation candidate pipeline
1. Detect and verify face landmarks and segmentation quality.
2. Estimate a depth-aware face/neck mesh, or fit an expressive 3D model.
3. Align photo texture; create identity-stable UV/face texture, eye and eyelid representations.
4. Reconstruct plausible occluded skin at small head angles without obvious stretching.
5. Prepare blink eyelid states, expression controls, head turn corrections if needed.
6. Build voice mouth geometry and texture support later; teeth and tongue need special attention.
7. Compress textures using supported formats; export geometry as glTF/GLB where suitable.
8. Author asset manifest with SHA-256, sizes, generation model/tool/license metadata, source consent record, and reproducible pipeline version.
9. Test side-by-side against an unanimated base for identity and temporal stability.

## Research experiments before choosing a pipeline
**A**: 2D deformation, masked eye layers + gaze and blink — inexpensive, but prone to uncanny artifacts.
**B**: 2.5D depth-aware face projection — stronger parallax, harder disocclusion.
**C**: photorealistic textured 3D face rig — natural geometry, difficult reconstruction from one image.
**D**: pre-generated view-dependent microclips and appearance atlas — potentially photorealistic but expensive transitions and storage.
Prefer a hybrid rig + selective detail correction IF it wins measured tests.

## Commercial licensing checkpoint
Confirm source code, pretrained model weights, datasets, generated output rights, and any third-party tool terms individually. Do not assume a publicly downloadable model is commercially usable. Track exact commit/version, license URL and whether derivative assets may be sold.

## GPU cost model
Permit occasional offline GPU work for initial character creation. Routine rendering should not require recurrent per-frame diffusion or expensive GPU instance. Verify constraints on the connected Quadro K1200 (4GB), including compatibility and actual performance; do not promise the machine can run every preparation model.

## Readiness
Asset manifest currently marks all real source and prepared assets missing. Filling a filename alone does not constitute a validated lifelike rig; acceptance includes video movement proof and test metrics.
