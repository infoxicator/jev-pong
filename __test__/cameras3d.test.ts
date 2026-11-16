import { expect,it } from 'vitest';
import { createGame } from '../src/physics';
import { cameraPose,ballPosition,EYE_HEIGHT,lane,robotX,strikeX } from '../src/arena3d/cameras';
it('places opposing player cameras at robot eye height, facing each other',()=>{
  const game=createGame(),left=cameraPose('left',game),right=cameraPose('right',game);
  expect(left.position[0]).toBeLessThan(strikeX('left'));expect(right.position[0]).toBeGreaterThan(strikeX('right'));
  expect(left.position[1]).toBe(EYE_HEIGHT);expect(right.position[1]).toBe(EYE_HEIGHT);
  expect(left.target[0]).toBeGreaterThan(left.position[0]);expect(right.target[0]).toBeLessThan(right.position[0]);
  expect(left.position[0]).toBeCloseTo(-right.position[0]);expect(robotX('left')).toBeCloseTo(-robotX('right'));
  game.paddles.left+=80;expect(cameraPose('left',game).position[2]-left.position[2]).toBeCloseTo(lane(360)-lane(280));
});
it('shows the full court from the side and maps state without mutating physics',()=>{
  const game=createGame(),before=structuredClone(game),spectator=cameraPose('spectator',game,2.5);
  expect(spectator.position[2]).toBeGreaterThan(5);expect(spectator.position[1]).toBeGreaterThan(EYE_HEIGHT);
  expect(ballPosition(game)[0]).toBe(0);expect(ballPosition(game)[2]).toBe(0);expect(game).toEqual(before);
});
