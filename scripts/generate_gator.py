# Headless Blender 5.2: builds a detailed alligator (body + tail + eyes)
# and exports public/models/gator.glb. Tail origin sits at the joint so the
# game can sway it. Teeth use a second material slot (arrays pass through).
# Run: blender.exe --background --python scripts/generate_gator.py
import bpy
import math
import os
from mathutils import Matrix

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'gator.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def make_mat(name, base, rough=0.85, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = base
    bsdf.inputs['Roughness'].default_value = rough
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = emission
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return m


skin = make_mat('GatorSkin', (0.23, 0.27, 0.14, 1))
belly = make_mat('GatorBelly', (0.35, 0.33, 0.22, 1))
teeth_m = make_mat('GatorTeeth', (0.85, 0.83, 0.75, 1), rough=0.5)
eyes_m = make_mat('GatorEyes', (0.02, 0.02, 0.02, 1),
                  emission=(0.85, 0.92, 0.30, 1), emission_strength=3.0)


def finish(obj, mat):
    if mat is not None:
        obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def prim(op, mat, name, **kw):
    op(**kw)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat)


parts = []
# torso: heavy barrel body
b = prim(bpy.ops.mesh.primitive_uv_sphere_add, None, 'part_body', segments=18, ring_count=12, radius=1)
b.scale = (1.05, 0.36, 0.42)
bpy.ops.object.select_all(action='DESELECT')
b.select_set(True)
bpy.context.view_layer.objects.active = b
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
b.data.materials.append(skin)
parts.append(b)
# belly plate: lighter underside slightly inset
bl = prim(bpy.ops.mesh.primitive_uv_sphere_add, None, 'part_belly', segments=14, ring_count=8, radius=1)
bl.scale = (0.92, 0.30, 0.36)
bl.location = (0, -0.10, 0)
bpy.ops.object.select_all(action='DESELECT')
bl.select_set(True)
bpy.context.view_layer.objects.active = bl
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bl.data.materials.append(belly)
parts.append(bl)
# snout: broad flat upper jaw, tapered by pinching front verts
sn = prim(bpy.ops.mesh.primitive_cube_add, None, 'part_snout', size=1)
sn.scale = (0.55, 0.16, 0.27)
sn.location = (1.0, 0.05, 0)
bpy.ops.object.select_all(action='DESELECT')
sn.select_set(True)
bpy.context.view_layer.objects.active = sn
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
mesh = sn.data
for v in mesh.vertices:
    if v.co.x > 1.15:
        v.co.z *= 0.55
        v.co.y -= 0.02
mesh.update()
mesh.materials.append(skin)
parts.append(sn)
# lower jaw: thinner, slightly open
jw = prim(bpy.ops.mesh.primitive_cube_add, None, 'part_jaw', size=1)
jw.scale = (0.45, 0.07, 0.20)
jw.location = (0.98, -0.10, 0)
bpy.ops.object.select_all(action='DESELECT')
jw.select_set(True)
bpy.context.view_layer.objects.active = jw
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
jw.data.materials.append(belly)
parts.append(jw)
# teeth: small white cones along the upper jaw rim, pointing down
for i in range(5):
    x = 0.78 + i * 0.13
    for sz in (-1, 1):
        th = prim(bpy.ops.mesh.primitive_cone_add, None, 'tooth', radius1=0.022, depth=0.09)
        th.rotation_euler = (math.pi / 2, 0, 0)
        th.location = (x, -0.03, sz * 0.20)
        bpy.ops.object.select_all(action='DESELECT')
        th.select_set(True)
        bpy.context.view_layer.objects.active = th
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        th.data.materials.append(teeth_m)
        parts.append(th)
# back ridges: two rows of sharp scutes
for i in range(9):
    x = -0.75 + i * 0.19
    for sz in (-1, 1):
        c = prim(bpy.ops.mesh.primitive_cone_add, None, 'ridge', radius1=0.05, depth=0.16)
        c.location = (x, 0.35, sz * 0.12)
        c.data.materials.append(skin)
        parts.append(c)
# legs with flattened feet
for lx, lz in [(0.5, 0.36), (0.5, -0.36), (-0.5, 0.38), (-0.5, -0.38)]:
    lg = prim(bpy.ops.mesh.primitive_cylinder_add, None, 'leg', radius=0.09, depth=0.34)
    lg.location = (lx, -0.26, lz)
    lg.data.materials.append(skin)
    parts.append(lg)
    ft = prim(bpy.ops.mesh.primitive_cube_add, None, 'foot', size=1)
    ft.scale = (0.22, 0.07, 0.18)
    ft.location = (lx + 0.05, -0.42, lz)
    bpy.ops.object.select_all(action='DESELECT')
    ft.select_set(True)
    bpy.context.view_layer.objects.active = ft
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ft.data.materials.append(skin)
    parts.append(ft)

# join skin parts into GatorBody (keeps skin/belly/teeth material slots)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'GatorBody'

# tail: tall thin rudder, origin at the joint
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_cone_add(radius1=0.26, depth=1.6, location=(0, 0, 0))
tail = bpy.context.active_object
tail.name = 'GatorTail'
tail.scale = (1.0, 1.0, 0.55)
tail.rotation_euler = (0, -math.pi / 2, 0)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
tail.data.transform(Matrix.Translation((0.8, 0, 0)))
tail.data.materials.append(skin)
for p in tail.data.polygons:
    p.use_smooth = True
tail.location = (-0.7, 0.02, 0)
# tail ridge scutes
bpy.ops.object.select_all(action='DESELECT')
tail.select_set(True)
bpy.context.view_layer.objects.active = tail
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.object.mode_set(mode='OBJECT')

# eyes on raised bumps
bpy.ops.object.select_all(action='DESELECT')
eye_parts = []
for sz in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.075, location=(0.62, 0.24, sz * 0.15))
    bump = bpy.context.active_object
    bump.name = 'bump'
    finish(bump, skin)
    eye_parts.append(bump)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, location=(0.62, 0.31, sz * 0.15))
    e = bpy.context.active_object
    e.name = 'eye'
    finish(e, eyes_m)
    eye_parts.append(e)
bpy.ops.object.select_all(action='DESELECT')
for o in eye_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = eye_parts[0]
bpy.ops.object.join()
eyes = bpy.context.active_object
eyes.name = 'GatorEyes'

# export selection
bpy.ops.object.select_all(action='DESELECT')
for o in (body, tail, eyes):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)
print('GATOR_OK', OUT)
