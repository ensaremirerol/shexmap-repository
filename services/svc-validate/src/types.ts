export interface BindingEntry {
  variable: string;
  value: string;
  datatype?: string;
}

export interface BindingNode {
  shape: string;
  focus: string;
  bindings: BindingEntry[];
  children: BindingNode[];
}

export interface ValidationResult {
  shexValid: boolean;
  shexErrors: string[];
  rdfValid?: boolean;
  rdfErrors?: string[];
  valid: boolean;
  bindingTree: BindingNode[];
  bindings: Record<string, string>;
  targetRdf?: string;
  errors: string[];
}

export interface AuthContext {
  userId: string;
  role: string;
  authEnabled: boolean;
}
