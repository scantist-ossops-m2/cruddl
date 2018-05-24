import { GraphQLEnumType, GraphQLInputType } from 'graphql';
import { Field } from '../../model';
import {
    BinaryOperationQueryNode, BinaryOperator, CountQueryNode, FieldQueryNode, LiteralQueryNode, QueryNode,
    TransformListQueryNode, VariableQueryNode
} from '../../query-tree';
import { INPUT_FIELD_EVERY, INPUT_FIELD_NONE } from '../../schema/schema-defaults';
import { AnyValue, decapitalize } from '../../utils/utils';
import { buildSafeListQueryNode } from '../query-node-utils';
import { TypedInputFieldBase } from '../typed-input-object-type';
import { FilterObjectType } from './generator';


export interface FilterField extends TypedInputFieldBase<FilterField> {
    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode
}

export class ScalarOrEnumFieldFilterField implements FilterField {
    constructor(
        public readonly field: Field,
        public readonly resolveOperator: (fieldNode: QueryNode, valueNode: QueryNode) => QueryNode,
        public readonly operatorPrefix: string | undefined,
        public readonly inputType: GraphQLInputType|FilterObjectType
    ) {
    }

    get name() {
        if (this.operatorPrefix == undefined) {
            return this.field.name;
        }
        return `${this.field.name}_${this.operatorPrefix}`;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        // TODO relations etc.
        const valueNode = new FieldQueryNode(sourceNode, this.field);
        const literalNode = new LiteralQueryNode(filterValue);
        return this.resolveOperator(valueNode, literalNode);
    }
}

export class ScalarOrEnumFilterField implements FilterField {
    constructor(
        public readonly resolveOperator: (fieldNode: QueryNode, valueNode: QueryNode) => QueryNode,
        public readonly operatorName: string,
        public readonly inputType: GraphQLInputType|GraphQLEnumType
    ) {
    }

    get name() {
        return this.operatorName;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        const literalNode = new LiteralQueryNode(filterValue);
        return this.resolveOperator(sourceNode, literalNode);
    }
}

export class QuantifierFilterField implements FilterField {
    constructor(
        public readonly field: Field,
        public readonly quantifierName: string,
        public readonly inputType: FilterObjectType,
    ) {
    }

    get name() {
        return `${this.field.name}_${this.quantifierName}`;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {

        // every(P(x)) === none(!P(x))
        const quantifierForResult = this.quantifierName === INPUT_FIELD_EVERY ? INPUT_FIELD_NONE : this.quantifierName;
        const filterValueForResult = this.quantifierName === INPUT_FIELD_EVERY ? {not: filterValue} : filterValue;

        const listNode = buildSafeListQueryNode(sourceNode);
        const itemVariable = new VariableQueryNode(decapitalize(this.field.name));
        const filterNode = this.inputType.getFilterNode(sourceNode, filterValueForResult);
        const filteredListNode = new TransformListQueryNode({
            listNode,
            filterNode,
            itemVariable
        });

        return new BinaryOperationQueryNode(new CountQueryNode(filteredListNode),
            quantifierForResult === 'none' ? BinaryOperator.EQUAL : BinaryOperator.GREATER_THAN, new LiteralQueryNode(0));

    }
}

export class NestedObjectFilterField implements FilterField {
    constructor(
        public readonly field: Field,
        public readonly inputType: FilterObjectType
    ) {
    }

    get name() {
        return this.field.name;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        return this.inputType.getFilterNode(sourceNode, filterValue);
    }
}

export interface ListFilterField extends FilterField {
    readonly inputType: FilterObjectType
    readonly field: Field
}

