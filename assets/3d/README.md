# Robot model

Original humanoid robot inspired by the industrial design of Optimus: white alloy plates, black optical face, exposed titanium joints, articulated limbs and fingers, and a table-tennis racket. No downloaded meshes, external textures, paid generators or provider calls.

- `robot-studio.blend`: editable Blender 5.2.2 source, metres, facing Blender -Y.
- `../../scripts/blender/build_robot.py`: reproducible authoring script. Always run in a background factory scene.
- `../../public/models/arena-robot.glb`: exported glTF 2.0 asset, browser +Y up / +Z forward, 133 scene objects, about 1 MB. Its named shoulder, elbow, wrist, hip, knee and ankle pivots support two-bone inverse kinematics. The 172 × 192 mm blade has thin red/black rubber sheets, a maple core, edge tape and a walnut handle gripped by curled fingers. `RacketContact` marks the striking surface; the racket is parented to the right wrist.

The browser duplicates this asset for Vector and Chaos and assigns their individual accent colors. The source file contains one model so editing it updates both players on re-export. Materials use glTF-compatible metallic/roughness PBR; the Three.js scene supplies studio lighting, reflections and shadows.

`src/arena3d/table-tennis-robot.ts` drives the existing named joints for the 3D ruleset: crouch, torso rotation and weight transfer, two-handed service preparation, forehand/backhand stroke paths, wrist rotation, balancing free arm and alternating lateral steps. Actual ball contact comes from the server's recorded stroke; follow-through moves with the recovering torso. The model asset itself is unchanged by this animation update.
