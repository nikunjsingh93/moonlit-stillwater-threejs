# Rebuilds public/models/boat.glb headlessly. Optional upgrade over the in-code boat.
import bpy, os
out = os.path.join(os.path.dirname(__file__), "..", "public", "models", "boat.glb")
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
bpy.ops.mesh.primitive_cube_add(size=2)
hull = bpy.context.active_object; hull.name = "Hull"; hull.scale = (2.3, 0.95, 0.45)
bpy.ops.object.transform_apply(scale=True)
mat = bpy.data.materials.new("Wood"); mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.29, 0.20, 0.13, 1)
bsdf.inputs["Roughness"].default_value = 0.85
hull.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format='GLB', use_selection=True)
print("wrote", out)
