import { Args, Mutation, Resolver, Query } from '@nestjs/graphql';
import { PropertyService } from './property.service';
import { Properties, Property } from '../../libs/dto/property/property';
import {
	AgentPropertiesInquiry,
	AllProperitesInquiry,
	OrdinaryInquiry,
	PropertiesInquiry,
	PropertyInput,
} from '../../libs/dto/property/property.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { ObjectId } from 'mongoose';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { PropertyUpdate } from '../../libs/dto/property/property.update';
import { AuthGuard } from '../auth/guards/auth.guard';

@Resolver()
export class PropertyResolver {
	constructor(private readonly propertyService: PropertyService) {}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation(() => Property)
	public async createProperty(
		@Args('input') input: PropertyInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Property> {
		console.log('Mutation: createProperty');

		// aynan osha property qoshayotgan memberni ID sini va uni AuthMember decorator orqali olyabmiz
		// kirib kelayotgan memberID siga Authentication jarayonidan olingan memberId ni yuklab olamiz. chunki bu frontend dan kelmaydi sababi property inputda biriktirmaganmz
		input.memberId = memberId;
		return await this.propertyService.createProperty(input);
	}

	@UseGuards(WithoutGuard)
	@Query((returns) => Property)
	public async getProperty(
		@Args('propertyId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Property> {
		console.log('Query: getProperty');

		const propertyId = shapeIntoMongoObjectId(input);
		return await this.propertyService.getProperty(memberId, propertyId);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Mutation((returns) => Property)
	// (Property)-> yangilangan property ni qaytaradi
	public async updateProperty(
		@Args('input') input: PropertyUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Property> {
		console.log('Mutation: updateProperty');

		// memberId => murojatchini id si

		input._id = shapeIntoMongoObjectId(input._id);
		return await this.propertyService.updateProperty(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Properties)
	public async getProperties(
		@Args('input') input: PropertiesInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Properties> {
		console.log('Query: getProperties');

		return await this.propertyService.getProperties(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => Properties)
	public async getFavorites(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Properties> {
		console.log('Query: getFavorite');

		return await this.propertyService.getFavorites(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => Properties)
	public async getVisited(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Properties> {
		console.log('Query: getVisited');

		return await this.propertyService.getVisited(memberId, input);
	}

	@Roles(MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query((returns) => Properties)
	public async getAgentProperties(
		@Args('input') input: AgentPropertiesInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Properties> {
		console.log('Query: getAgetnsProperties');

		return await this.propertyService.getAgentProperties(memberId, input);
	}

	/**  LIKE  **/

	@UseGuards(AuthGuard)
	@Mutation((returns) => Property)
	public async likeTargetProperty(
		@Args('propertyId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Property> {
		console.log('Mutation: likeTargetProperty');

		const likeRefId = shapeIntoMongoObjectId(input);

		return await this.propertyService.likeTargetProperty(memberId, likeRefId);
	}

	/**  ADMIN  **/

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query((returns) => Properties) //-> Properties
	public async getAllPropertiesByAdmin(
		@Args('input') input: AllProperitesInquiry,
		// @AuthMember('_id') memberId: ObjectId,
	): Promise<Properties> {
		console.log('Query: getAllPropertiesByAdmin');

		return await this.propertyService.getAllPropertiesByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation((returns) => Property)
	public async updatePropertyByAdmin(@Args('input') input: PropertyUpdate): Promise<Property> {
		console.log('Mutation: updatePropertyByAdmin');

		input._id = shapeIntoMongoObjectId(input._id);

		return await this.propertyService.updatePropertyByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation((returns) => Property)
	public async removePropertyByAdmin(@Args('input') input: string): Promise<Property> {
		console.log('Mutation: removePropertyByAdmin');

		const propertyId = shapeIntoMongoObjectId(input);
		return await this.propertyService.removePropertyByAdmin(propertyId);
	}
}
