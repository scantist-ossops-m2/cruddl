import { groupBy } from 'lodash';
import { objectValues } from '../../utils/utils';
import { FieldConfig, ObjectTypeConfig } from '../config';
import { Severity, ValidationContext, ValidationMessage } from '../validation';
import { Field, SystemFieldConfig } from './field';
import { Model } from './model';
import { ObjectType } from './type';
import { TypeBase } from './type-base';
import { TypeModuleSpecification } from './modules/type-module-specification';
import memorize from 'memorize-decorator';
import { EffectiveModuleSpecification } from './modules/effective-module-specification';

export abstract class ObjectTypeBase extends TypeBase {
    readonly fields: ReadonlyArray<Field>;
    private readonly fieldMap: ReadonlyMap<string, Field>;
    readonly systemFieldOverrides: ReadonlyMap<string, FieldConfig>;
    readonly systemFields: ReadonlyMap<string, Field>;
    readonly systemFieldConfigs: ReadonlyMap<string, SystemFieldConfig>;
    readonly moduleSpecification?: TypeModuleSpecification;

    protected constructor(
        input: ObjectTypeConfig,
        model: Model,
        systemFieldInputs: ReadonlyArray<SystemFieldConfig> = [],
    ) {
        super(input, model);
        const thisAsObjectType: ObjectType = this as any;

        this.systemFieldConfigs = new Map(
            systemFieldInputs.map((systemFieldInput) => [systemFieldInput.name, systemFieldInput]),
        );

        this.systemFieldOverrides = new Map(
            (input.fields || [])
                .filter((customField) =>
                    systemFieldInputs.some((systemField) => systemField.name === customField.name),
                )
                .map((field) => [field.name, field]),
        );

        const customFields = (input.fields || [])
            .filter((customField) => !this.systemFieldOverrides.has(customField.name))
            .map((field) => new Field(field, thisAsObjectType));

        const systemFields = (systemFieldInputs || []).map(
            (input) =>
                new Field(
                    {
                        ...input,
                        isSystemField: true,
                        ...this.systemFieldOverrideToSystemFieldConfig(input),
                    },
                    thisAsObjectType,
                ),
        );

        this.systemFields = new Map(
            systemFields.map((systemField) => [systemField.name, systemField]),
        );

        this.fields = [...systemFields, ...customFields];
        this.fieldMap = new Map(this.fields.map((field): [string, Field] => [field.name, field]));

        if (input.moduleSpecification) {
            this.moduleSpecification = new TypeModuleSpecification(
                input.moduleSpecification,
                this.model,
            );
        }
    }

    validate(context: ValidationContext) {
        super.validate(context);

        if (!this.fields.filter((f) => !f.isSystemField).length) {
            context.addMessage(
                ValidationMessage.error(
                    `Object type "${this.name}" does not declare any fields.`,
                    this.nameASTNode,
                ),
            );
        }

        this.validateDuplicateFields(context);
        this.validateSystemFieldOverrides(context);

        for (const field of this.fields) {
            field.validate(context);
        }

        this.validateModuleSpecification(context);
    }

    private validateSystemFieldOverrides(context: ValidationContext): void {
        for (const systemFieldOverride of this.systemFieldOverrides.values()) {
            const systemField = this.getSystemFieldOrThrow(systemFieldOverride.name);
            if (systemField.type.name !== systemFieldOverride.typeName) {
                context.addMessage(
                    new ValidationMessage(
                        Severity.ERROR,
                        `System field "${systemField.name}" must be of type "${systemField.type.name}"`,
                        systemField.astNode,
                    ),
                );
            }

            if (!systemFieldOverride.astNode?.directives?.length) {
                context.addMessage(
                    new ValidationMessage(
                        Severity.WARNING,
                        `Manually declaring system field "${systemField.name}" is redundant. Either add a suitable directive or consider removing the field`,
                        systemField.astNode,
                    ),
                );
            }

            const allowedSystemFieldDirectives =
                this.systemFieldConfigs.get(systemFieldOverride.name)?.allowedDirectiveNames ?? [];
            const forbiddenSystemFieldDirectives =
                systemFieldOverride.astNode?.directives?.filter(
                    (directive) => !allowedSystemFieldDirectives.includes(directive.name.value),
                ) ?? [];
            for (const forbiddenDirective of forbiddenSystemFieldDirectives) {
                context.addMessage(
                    new ValidationMessage(
                        Severity.ERROR,
                        `Directive "@${forbiddenDirective.name.value}" is not allowed on system field "${systemFieldOverride.name}" and will be discarded`,
                        forbiddenDirective,
                    ),
                );
            }
        }
    }

    private validateDuplicateFields(context: ValidationContext) {
        const duplicateFields = objectValues(groupBy(this.fields, (field) => field.name)).filter(
            (fields) => fields.length > 1,
        );
        for (const fields of duplicateFields) {
            for (const field of fields) {
                if (field.isSystemField) {
                    // don't report errors for system fields the user didn't even write
                    continue;
                }

                context.addMessage(
                    ValidationMessage.error(
                        `Duplicate field name: "${field.name}".`,
                        field.astNode,
                    ),
                );
            }
        }
    }

    private validateModuleSpecification(context: ValidationContext) {
        if (this.moduleSpecification) {
            this.moduleSpecification.validate(context);
        }
    }

    getField(name: string): Field | undefined {
        return this.fieldMap.get(name);
    }

    getFieldOrThrow(name: string): Field {
        const field = this.getField(name);
        if (field == undefined) {
            throw new Error(`Field "${this.name}.${name}" is not declared`);
        }
        return field;
    }

    getSystemFieldOrThrow(name: string): Field {
        const field = this.systemFields.get(name);
        if (!field) {
            throw new Error(`System field ${name} not found`);
        }
        return field;
    }

    private systemFieldOverrideToSystemFieldConfig(fieldConfig: FieldConfig): Partial<FieldConfig> {
        const override = this.systemFieldOverrides.get(fieldConfig.name);
        if (!override) {
            return {};
        }
        return {
            isHidden: !!override.isHidden,
            isHiddenASTNode: override.isHiddenASTNode,
        };
    }

    @memorize()
    get effectiveModuleSpecification(): EffectiveModuleSpecification {
        // clauses being undefined is an error state, recover gracefully
        if (!this.moduleSpecification || !this.moduleSpecification.clauses) {
            // if modules are not specified, do not restrict this - just included it whenever the types are used
            return super.effectiveModuleSpecification;
        }

        return new EffectiveModuleSpecification({
            orCombinedClauses: this.moduleSpecification.clauses,
        });
    }

    readonly isObjectType: true = true;
    readonly isScalarType: false = false;
    readonly isEnumType: false = false;
}
