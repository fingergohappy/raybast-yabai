

export interface ISpace {
  index: number;
  id: string;
  label: string;
}

export interface IWindow {
  space: number;
  id: number;
  pid: number;
  title: string;
  app: string;
  icon: string;
  "is-sticky": boolean;
}