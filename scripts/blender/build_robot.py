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
rubber=material('Racket rubber',(.009,.012,.014),0,.88)
wood=material('Laminated maple blade',(.52,.29,.12),0,.53)
gripwood=material('Walnut flared handle',(.15,.065,.026),0,.48)
red=material('Racket reverse',(.55,.018,.012),0,.84)
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
    foot=pivot('Ankle_'+label,ankle,shin)
    ball('Ankle_joint_'+label,ankle,(.065,.067,.065),steel,foot)
    box('Sole_'+label,(.135*sign,-.075,.049),(.145,.30,.060),black,foot,.025)
    box('Foot_armor_'+label,(.135*sign,-.078,.09),(.139,.28,.065),shell,foot,.024)
    for j in range(3):box('Toe_split',(.135*sign,-.18+j*.025,.124),(.115,.005,.004),black,foot,.001)
# Ready stance. Right hand holds the racket in front of the chest.
for sign,label in [(-1,'L'),(1,'R')]:
    shoulder=(.29*sign,0,1.47)
    elbow=(.37*sign,-.12,1.13) if label=='R' else (-.37,.015,1.16)
    wrist=(.30,-.53,1.035) if label=='R' else (-.35,-.16,.95)
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
    if label=='R':
        box('Palm_R',Vector(wrist)+Vector((0,-.010,.005)),(.066,.040,.076),steel,hand,.012)
        # Four articulated fingers curl around the handle; the thumb closes above them.
        for finger in range(4):
            z=1.019+finger*.017
            points=[(.334,-.545,z),(.329,-.579,z),(.299,-.585,z),(.278,-.567,z)]
            for j in range(3):rod('Finger_R_%d_%d'%(finger,j),points[j],points[j+1],.008,chrome,hand)
        rod('Thumb_R_base',(.265,-.536,1.067),(.270,-.565,1.089),.011,chrome,hand)
        rod('Thumb_R_tip',(.270,-.565,1.089),(.294,-.578,1.092),.010,chrome,hand)
    else:
        box('Palm_'+label,Vector(wrist)+Vector((0,-.055,-.015)),(.092,.105,.055),steel,hand,.015)
        for finger in range(4):
            x=wrist[0]+(finger-1.5)*.023
            for j in range(3):
                box('Finger_%s_%d_%d'%(label,finger,j),(x,wrist[1]-.09-j*.018,wrist[2]-.04-j*.012),(.018,.027,.025),chrome,hand,.006)
        rod('Thumb_'+label,Vector(wrist)+Vector((-.055,-.02,0)),Vector(wrist)+Vector((-.055,-.11,-.025)),.018,chrome,hand)
# Regulation-scale laminated blade: 172 x 192 mm, 6 mm wood + two rubber sheets.
# Build the ellipse in world X/Z so cylinder local-axis scaling cannot distort its thickness.
tool=pivot('Racket',(.30,-.56,1.19),right_hand)
def blade(name,center,rx,rz,depth,mat):
    x,y,z=center;n=64
    verts=[(x+rx*math.cos(i*2*math.pi/n),y+d,z+rz*math.sin(i*2*math.pi/n)) for d in [-depth/2,depth/2] for i in range(n)]
    # An increasing X/Z ring has a -Y normal. Wind the lower cap and walls
    # accordingly so the bevel and both rubber faces shade outward.
    faces=[tuple(range(n)),tuple(range(2*n-1,n-1,-1))]
    faces += [(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    finish(obj,name,mat,tool,.0006)
    # Flat rubber faces, smoothly shaded circumference.
    for poly in obj.data.polygons:poly.use_smooth=poly.index>=2
    return obj
blade('Racket_blade',(.30,-.56,1.19),.086,.096,.006,wood)
blade('Racket_edge_tape',(.30,-.56,1.19),.087,.097,.005,rubber)
blade('Racket_face',(.30,-.566,1.19),.0845,.0945,.004,red)
blade('Racket_reverse',(.30,-.554,1.19),.0845,.0945,.004,rubber)
# Handle ends inside the closed hand, not below it as a floating metal shaft.
box('Racket_handle',(.30,-.56,1.066),(.029,.026,.110),gripwood,tool,.008)
box('Racket_handle_inlay',(.30,-.575,1.067),(.009,.002,.083),wood,tool,.001)
box('Racket_handle_flare',(.30,-.56,1.018),(.035,.028,.018),gripwood,tool,.005)
pivot('RacketContact',(.30,-.568,1.19),tool)
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
