import * as THREE from 'three';

export function updateRippleAnimation(
  group: THREE.Group,
  time: number
) {
  group.rotation.y = 0; // 全体回転はオフ

  group.children.forEach((child) => {
    const baseTarget = child.userData.flatPos as THREE.Vector3;
    let target = baseTarget.clone();

    // 平面の中心（0, 0）からの距離を計算
    const distance = Math.sqrt(target.x * target.x + target.y * target.y);

    // 中心から外側へ波紋が広がるようにZ軸方向へ変位させる
    const zOffset = Math.sin(distance * 0.8 - time * 3.0) * 1.5;
    target.z += zOffset;

    child.position.lerp(target, 0.08);
    child.rotation.set(0, 0, 0);
  });
}
