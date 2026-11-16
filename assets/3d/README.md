# Robot model

Original humanoid robot inspired by the industrial design of Optimus: white alloy plates, black optical face, exposed titanium joints, articulated limbs and fingers, and a table-tennis racket. No downloaded meshes, external textures, paid generators or provider calls.

- `robot-studio.blend`: editable Blender 5.2.2 source, metres, facing Blender -Y.
- `../../scripts/blender/build_robot.py`: reproducible authoring script. Always run in a background factory scene.
- `../../public/models/arena-robot.glb`: exported glTF 2.0 asset, browser +Y up / +Z forward, 137 scene objects, about 1 MB. Its named head/arm/leg/racket hierarchy supports the lightweight game animation. The racket is parented to the right wrist.

The browser duplicates this asset for Vector and Chaos and assigns their individual accent colors. The source file contains one model so editing it updates both players on re-export. Materials use glTF-compatible metallic/roughness PBR; the Three.js scene supplies studio lighting, reflections and shadows.
