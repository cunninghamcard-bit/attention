export interface ApiDocParameter {
  name: string;
  type: string;
  optional?: boolean;
  description?: string;
}

export interface ApiDocMethod {
  name: string;
  description: string;
  parameters?: ApiDocParameter[];
  returns?: string;
}

export interface ApiDocNamespace {
  name: string;
  description: string;
  methods: ApiDocMethod[];
}

export interface ApiDocPage {
  title: string;
  namespaces: ApiDocNamespace[];
}
