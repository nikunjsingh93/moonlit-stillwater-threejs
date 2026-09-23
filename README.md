# Moonlit Stillwater — fresh build (does NOT touch moonlit-swamp)

Real-time Three.js swamp boat ride: moonlit water shader, procedural skiff with
flickering lantern, instanced cypress/reeds/lilies, fireflies, drifting mist,
bloom + vignette, WASD steering, evening-mode toggle.

## Run
```bash
npm install
npm run dev      # http://localhost:5174
npm run build
```
## Blender (optional, not required)
`scripts/generate_boat.py` rebuilds a higher-detail skiff to `public/models/boat.glb`
using headless Blender 5.2. The in-code procedural boat is used by default so the
scene runs with zero downloaded assets.
```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python scripts/generate_boat.py
```
## Controls
W/S throttle · A/D steer · drag to look · R reset · click for ambient sound.
