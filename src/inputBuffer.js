// Preserve a short action tap until the fixed-step simulation actually consumes it.
// Held input still comes from the existing keyboard/pointer sources.
export class ActionBuffer {
  pending = new Set();
  cancelledKick = false;
  press(code) {
    if (['Space', 'KeyQ', 'KeyE'].includes(code)) this.pending.add(code);
  }
  cancel(code, heldElsewhere = false) {
    if (heldElsewhere) return;
    this.pending.delete(code);
    if (code === 'KeyQ') this.cancelledKick = true;
  }
  sample(held) {
    const down = code => held(code) || this.pending.has(code);
    return {
      steer: (held('KeyD') || held('ArrowRight') ? 1 : 0) - (held('KeyA') || held('ArrowLeft') ? 1 : 0),
      jump: down('Space'), kick: down('KeyQ'), dash: down('KeyE'),
      jumpPressed: this.pending.has('Space'), dashPressed: this.pending.has('KeyE'),
      cancelKick: this.cancelledKick,
    };
  }
  consume(steps) { if (steps > 0) this.clear(); }
  clear() { this.pending.clear(); this.cancelledKick = false; }
}
