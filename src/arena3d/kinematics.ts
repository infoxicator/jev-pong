import * as THREE from 'three';

/** Two-bone IK in world coordinates. Keeps authored limb lengths and joint hierarchy. */
export function solveLimb(upper:THREE.Object3D,lower:THREE.Object3D,end:THREE.Object3D,target:THREE.Vector3,pole:THREE.Vector3){
  upper.updateWorldMatrix(true,true);
  const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=end.getWorldPosition(new THREE.Vector3());
  const l1=a.distanceTo(b),l2=b.distanceTo(c),axis=target.clone().sub(a),distance=THREE.MathUtils.clamp(axis.length(),Math.abs(l1-l2)+.0001,l1+l2-.0001);
  axis.normalize();
  const bend=pole.clone().sub(a);bend.addScaledVector(axis,-bend.dot(axis));
  if(bend.lengthSq()<1e-8)bend.set(0,0,1).addScaledVector(axis,-axis.z);
  bend.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
  const elbow=a.clone().addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,l1*l1-along*along)));
  aim(upper,b.clone().sub(a),elbow.clone().sub(a));
  upper.updateWorldMatrix(true,true);
  const joint=lower.getWorldPosition(new THREE.Vector3()),tip=end.getWorldPosition(new THREE.Vector3());
  aim(lower,tip.sub(joint),a.clone().addScaledVector(axis,distance).sub(joint));
  lower.updateWorldMatrix(true,true);
}
function aim(joint:THREE.Object3D,from:THREE.Vector3,to:THREE.Vector3){
  const rotation=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize()).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
  setWorldRotation(joint,rotation);
}
export function setWorldRotation(object:THREE.Object3D,rotation:THREE.Quaternion){
  const parent=object.parent?.getWorldQuaternion(new THREE.Quaternion())??new THREE.Quaternion();
  object.quaternion.copy(parent.invert().multiply(rotation));
}
