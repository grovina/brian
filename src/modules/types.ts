export interface ModuleMeta {
  id: string;
  name: string;
  description: string;
  default?: boolean;
}

export interface CheckResult {
  installed: boolean;
  version?: string;
  issues?: string[];
}

export interface InstallContext {
  appDir: string;
  stateDir: string;
  frameworkDir: string;
}

export interface Module {
  meta: ModuleMeta;
  check(ctx: InstallContext): Promise<CheckResult>;
  install(ctx: InstallContext): Promise<void>;
}
