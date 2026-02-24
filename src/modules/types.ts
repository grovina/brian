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
  repoDir: string;
  stateDir: string;
}

export interface Module {
  meta: ModuleMeta;
  check(ctx: InstallContext): Promise<CheckResult>;
  install(ctx: InstallContext): Promise<void>;
}
