export interface TrafficLightPosition {
  x: number;
  y: number;
}

export class WindowFrameController {
  private trafficLightPosition: TrafficLightPosition = { x: 12, y: 12 };
  private fullscreen = false;

  setTrafficLightPosition(position: TrafficLightPosition): void {
    this.trafficLightPosition = position;
  }

  getTrafficLightPosition(): TrafficLightPosition {
    return { ...this.trafficLightPosition };
  }

  setFullscreen(fullscreen: boolean): void {
    this.fullscreen = fullscreen;
  }

  isFullscreen(): boolean {
    return this.fullscreen;
  }
}
