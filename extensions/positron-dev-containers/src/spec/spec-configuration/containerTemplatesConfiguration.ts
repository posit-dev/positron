export interface Template {
	id: string;
	version?: string;
	name?: string;
	description?: string;
	documentationURL?: string;
	licenseURL?: string;
	type?: string;             // Added programatically during packaging
	fileCount?: number;        // Added programatically during packaging
	featureIds?: string[];
	options?: Record<string, TemplateOption>;
	platforms?: string[];
	publisher?: string;
	keywords?: string[];
	optionalPaths?: string[];
	files: string[];           // Added programatically during packaging
}

export type TemplateOption = {
	type: 'boolean';
	default?: boolean;
	description?: string;
} | {
	type: 'string';
	enum?: string[];
	default?: string;
	description?: string;
} | {
	type: 'string';
	default?: string;
	proposals?: string[];
	description?: string;
};
