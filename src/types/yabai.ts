export interface ISpace {
  index: number;
  id: string;
  label: string;
}

export interface IWindow {
  space: number;
  id: number;
  frame: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  pid: number;
  title: string;
  app: string;
  icon: string;
  "is-sticky": boolean;
  "has-focus": boolean;
  "is-floating": boolean;
  "stack-index": number;
}
