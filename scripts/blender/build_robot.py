"""Original Optimus-inspired humanoid, built locally with Blender. No downloaded assets.
Run: Blender --background --python scripts/blender/build_robot.py -- /absolute/repo
"""
import bpy, math, sys, os
from mathutils import Vector
root_path=sys.argv[sys.argv.index('--')+1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def material(name,color,metal=0,rough=.3,glow=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
    if bs.inputs.get('Coat Weight'):bs.inputs['Coat Weight'].default_value=.3
    if glow:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=glow
    m.diffuse_color=(*color,1);return m
shell=material('Ceramic pearl / coated alloy',(.78,.82,.83),.5,.23)
black=material('Graphite / elastomer',(.025,.032,.038),.25,.38)
steel=material('Brushed titanium',(.25,.29,.32),.86,.24)
chrome=material('Machined joint edges',(.6,.65,.69),.92,.17)
visor=material('Obsidian / optical glass',(.008,.013,.022),.68,.12)
accent=material('Team accent',(.98,.29,.07),.5,.26,1.5)
rubber=material('Racket rubber',(.055,.065,.07),.05,.67)
red=material('Racket reverse',(.36,.035,.025),.05,.7)
objects=[]

def parent_keep(obj,parent):
    if parent:
        bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world
    objects.append(obj);return obj

def pivot(name,pos,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=pos;return parent_keep(o,parent)

def finish(obj,name,mat,parent,bevel=0):
    obj.name=name;obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('Precision edge radius','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL')
    for p in obj.data.polygons:p.use_smooth=True
    return parent_keep(obj,parent)

def box(name,pos,size,mat,parent=None,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,parent,bevel)

def ball(name,pos,size,mat,parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=pos);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,parent)

def cyl(name,pos,radius,depth,mat,parent=None,axis=(0,0,1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=radius,depth=depth,location=pos)
    o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(Vector(axis).normalized())
    return finish(o,name,mat,parent,.005)

def rod(name,a,b,r,mat,parent=None):
    return cyl(name,(Vector(a)+Vector(b))/2,r,(Vector(b)-Vector(a)).length,mat,parent,Vector(b)-Vector(a))

robot=pivot('RobotRoot',(0,0,0))
# Segmented torso and exposed structural core.
box('Spine', (0,.035,1.22),(.16,.20,.43),black,robot,.04)
ball('Ribcage', (0,.025,1.40),(.27,.15,.245),black,robot)
box('Chest_Pearl', (0,-.105,1.42),(.465,.13,.30),shell,robot,.07)
box('Chest_black_inset',(0,-.179,1.39),(.29,.012,.055),visor,robot,.015)
box('Chest_signature',(0,-.189,1.41),(.13,.008,.007),accent,robot,.002)
box('Clavicle_L',(-.145,-.12,1.575),(.17,.09,.045),steel,robot,.015)
box('Clavicle_R',(.145,-.12,1.575),(.17,.09,.045),steel,robot,.015)
for i in range(4):
    box('Abdominal_plate_%02d'%i,(0,-.088,1.15+i*.045),(.25+i*.02,.075,.033),steel,robot,.01)
for sign in [-1,1]:
    rod('Flank hydraulic',(.17*sign,0,1.12),(.235*sign,.01,1.39),.018,chrome,robot)
box('Pelvis_body',(0,0,1.02),(.34,.245,.17),black,robot,.055)
box('Pelvis_front',(0,-.13,1.04),(.29,.065,.13),shell,robot,.04)
for sign in [-1,1]:
    ball('Hip_ball',(.15*sign,0,.97),(.10,.115,.10),steel,robot)
# Head: seamless black face, white rear shell, camera apertures, no human features.
cyl('Neck', (0,0,1.64),.065,.13,steel,robot)
head=pivot('Head',(0,0,1.70),robot)
ball('Head_pearl',(0,.012,1.79),(.122,.115,.165),shell,head)
ball('Face_glass',(0,-.078,1.79),(.108,.064,.14),visor,head)
box('Face_sensor_bar',(0,-.139,1.805),(.105,.012,.012),black,head,.004)
for x in [-.035,.035]:
    cyl('Optical_lens',(x,-.147,1.805),.009,.008,chrome,head,(0,-1,0))
    cyl('Optical_glass',(x,-.153,1.805),.005,.003,visor,head,(0,-1,0))
for sign in [-1,1]:
    cyl('Temple_disk',(.114*sign,.0,1.79),.043,.018,steel,head,(1,0,0))
    cyl('Temple_cover',(.126*sign,.0,1.79),.031,.012,shell,head,(1,0,0))
# Articulated legs, knee actuators and ankle dampers.
for sign,label in [(-1,'L'),(1,'R')]:
    hip=(.135*sign,.015,.965);knee=(.135*sign,-.018,.545);ankle=(.135*sign,.005,.145)
    leg=pivot('Thigh_'+label,hip,robot)
    rod('Femur_'+label,hip,knee,.064,black,leg)
    box('Thigh_armor_'+label,(.135*sign,-.035,.765),(.158,.16,.325),shell,leg,.045)
    cyl('Knee_axle_'+label,knee,.078,.19,chrome,leg,(1,0,0))
    shin=pivot('Shin_'+label,knee,leg)
    rod('Tibia_'+label,knee,ankle,.05,black,shin)
    box('Shin_armor_'+label,(.135*sign,-.029,.335),(.128,.145,.31),shell,shin,.035)
    box('Shin_insert_'+label,(.135*sign,-.106,.38),(.055,.008,.13),steel,shin,.008)
    rod('Ankle_hydraulic_'+label,(.19*sign,.05,.40),(.19*sign,.04,.16),.018,chrome,shin)
    ball('Ankle_joint_'+label,ankle,(.065,.067,.065),steel,shin)
    box('Sole_'+label,(.135*sign,-.075,.049),(.145,.30,.060),black,shin,.025)
    box('Foot_armor_'+label,(.135*sign,-.078,.09),(.139,.28,.065),shell,shin,.024)
    for j in range(3):box('Toe_split',(.135*sign,-.18+j*.025,.124),(.115,.005,.004),black,shin,.001)
# Ready stance. Right hand holds the racket in front of the chest.
for sign,label in [(-1,'L'),(1,'R')]:
    shoulder=(.29*sign,0,1.47)
    elbow=(.37*sign,-.12,1.13) if label=='R' else (-.37,.015,1.16)
    wrist=(.40,-.59,.94) if label=='R' else (-.35,-.16,.95)
    upper=pivot('UpperArm_'+label,shoulder,robot)
    ball('Shoulder_socket_'+label,shoulder,(.105,.105,.105),steel,upper)
    ball('Shoulder_armor_'+label,(.31*sign,-.012,1.465),(.105,.102,.11),shell,upper)
    rod('Humerus_'+label,shoulder,elbow,.054,black,upper)
    rod('Upper_arm_shell_'+label,Vector(shoulder).lerp(Vector(elbow),.26),Vector(shoulder).lerp(Vector(elbow),.76),.071,shell,upper)
    cyl('Elbow_axle_'+label,elbow,.061,.14,chrome,upper,(1,0,0))
    forearm=pivot('Forearm_'+label,elbow,upper)
    rod('Radius_'+label,elbow,wrist,.046,black,forearm)
    rod('Forearm_shell_'+label,Vector(elbow).lerp(Vector(wrist),.2),Vector(elbow).lerp(Vector(wrist),.78),.063,shell,forearm)
    rod('Forearm_tendon_'+label,Vector(elbow)+Vector((.035,0,.01)),Vector(wrist)+Vector((.035,0,.01)),.011,chrome,forearm)
    hand=pivot('Wrist_'+label,wrist,forearm)
    if label=='R':right_hand=hand
    ball('Wrist_bearing_'+label,wrist,(.05,.047,.05),steel,hand)
    box('Palm_'+label,Vector(wrist)+Vector((0,-.055,-.015)),(.092,.105,.055),steel,hand,.015)
    for finger in range(4):
        x=wrist[0]+(finger-1.5)*.023
        for j in range(3):
            box('Finger_%s_%d_%d'%(label,finger,j),(x,wrist[1]-.09-j*.018,wrist[2]-.04-j*.012),(.018,.027,.025),chrome,hand,.006)
    rod('Thumb_'+label,Vector(wrist)+Vector((-.055,-.02,0)),Vector(wrist)+Vector((-.055,-.11,-.025)),.018,chrome,hand)
# Separate named striking head attached to the right wrist. Negative Y is forward.
tool=pivot('Racket',(.40,-.71,1.055),right_hand)
rod('Racket_grip',(.40,-.71,.78),(.40,-.71,.99),.027,black,tool)
for z in [.80+i*.015 for i in range(10)]:cyl('Grip_wrap',(.40,-.71,z),.028,.005,steel,tool)
rim=cyl('Racket_rim',(.40,-.71,1.12),.25,.032,chrome,tool,(0,1,0));rim.scale.z=1.10
front=cyl('Racket_face',(.40,-.730,1.12),.239,.009,rubber,tool,(0,1,0));front.scale.z=1.10
rear=cyl('Racket_reverse',(.40,-.690,1.12),.239,.009,red,tool,(0,1,0));rear.scale.z=1.10
box('Racket_signature',(.40,-.737,1.04),(.085,.004,.008),accent,tool,.002)
# Tiny fasteners and access seams make close eye cameras read as machinery.
for sign in [-1,1]:
    for z in [1.33,1.52]:cyl('Chest_fastener',(.19*sign,-.178,z),.007,.006,chrome,robot,(0,1,0))
    for z in [.66,.87]:cyl('Thigh_fastener',(.19*sign,-.12,z),.006,.006,chrome,robot,(0,1,0))
# Export only this original asset and keep the editable source.
bpy.context.scene['asset_notes']='Original procedural Optimus-inspired humanoid. Dimensions in metres. Forward -Y in Blender / +Z in glTF. No external assets.'
for o in bpy.context.selected_objects:o.select_set(False)
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=robot
os.makedirs(os.path.join(root_path,'public/models'),exist_ok=True)
os.makedirs(os.path.join(root_path,'assets/3d'),exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root_path,'assets/3d/robot-studio.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(root_path,'public/models/arena-robot.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
print('ROBOT_EXPORT_OK',len(objects),'objects',os.path.getsize(os.path.join(root_path,'public/models/arena-robot.glb')),'bytes')
