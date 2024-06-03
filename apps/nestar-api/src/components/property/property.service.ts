import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Properties, Property } from '../../libs/dto/property/property';
import { Direction, Message } from '../../libs/enums/common.enum';
import {
	AgentPropertiesInquiry,
	AllProperitesInquiry,
	OrdinaryInquiry,
	PropertiesInquiry,
	PropertyInput,
} from '../../libs/dto/property/property.input';
import { MemberService } from '../member/member.service';
import { PropertyStatus } from '../../libs/enums/property.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { StatisticModifier, T } from '../../libs/types/common';
import { ViewService } from '../view/view.service';
import moment from 'moment';
import { PropertyUpdate } from '../../libs/dto/property/property.update';
import { lookupAuthMemberLiked, lookupMember, shapeIntoMongoObjectId } from '../../libs/config';
import { LikeService } from '../like/like.service';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeInput } from '../../libs/dto/like/like.input';

@Injectable()
export class PropertyService {
	constructor(
		@InjectModel('Property') private readonly propertyModel: Model<Property>,
		private memberService: MemberService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	public async createProperty(input: PropertyInput): Promise<Property> {
		try {
			const result = await this.propertyModel.create(input);

			//increase memberProperties
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberProperties',
				modifier: 1,
			});

			return result;
		} catch (err) {
			console.log('Error, createProperty service', err.message);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	public async getProperty(memberId: ObjectId, propertyId: ObjectId): Promise<Property> {
		const search: T = {
			_id: propertyId,
			propertyStatus: PropertyStatus.ACTIVE,
		};

		const targetProperty: Property = await this.propertyModel.findOne(search).lean().exec();

		// debugging purposes:only
		//console.log('targetProperty:', targetProperty); //-> debug and testing purpose

		if (!targetProperty) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (memberId) {
			const viewInput = { memberId: memberId, viewRefId: propertyId, viewGroup: ViewGroup.PROPERTY };

			// checking viewInput
			console.log('viewInput:', viewInput); // -> to later comment

			const newView = await this.viewService.recordView(viewInput);

			// checking newView
			//console.log('newview', newView);

			if (newView) {
				await this.propertyStatsEditor({ _id: propertyId, targetKey: 'propertyViews', modifier: 1 });
				targetProperty.propertyViews++;
			}
			//me liked
			const likeInput = { memberId: memberId, likeRefId: propertyId, likeGroup: LikeGroup.PROPERTY };
			targetProperty.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}
		// null bolishligiga sabab kim korayotganligini korishimiz shartmas
		targetProperty.memberData = await this.memberService.getMember(null, targetProperty.memberId);
		return targetProperty;
	}

	public async updateProperty(memberId: ObjectId, input: PropertyUpdate): Promise<Property> {
		// destruction
		let { propertyStatus, soldAt, deletedAt } = input;

		// declaration of searching mehanizmi
		const search: T = {
			_id: input._id, // aynan qaysi property ni yangilanishi kerakligini kirganizsh yani propertyni ID si required
			memberId: memberId, // faqatgina ozining property si bolsagina yangilay olishi uchun memberId ni authentication da qolga ovolamiz
			propertyStatus: PropertyStatus.ACTIVE, // faqatgina ACTIVE holatdagi propertylarni Agentlar update qila oladi
		};

		if (propertyStatus === PropertyStatus.SOLD) soldAt = moment().toDate();
		else if (propertyStatus === PropertyStatus.DELETE) deletedAt = moment().toDate();

		const result = await this.propertyModel.findOneAndUpdate(search, input, { new: true }).exec();

		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		if (soldAt || deletedAt) {
			// tekshiramiz agar sotilgan bolsa yoki ochirilgan bolsa osha agentni memberPropertysidan ochirilgan propertyni ayrib yuboramiz
			await this.memberService.memberStatsEditor({ _id: memberId, targetKey: 'memberProperties', modifier: -1 });
		}

		return result;
	}

	public async getProperties(memberId: ObjectId, input: PropertiesInquiry): Promise<Properties> {
		// match bolganda faqatgina foydalanuvchilar ACTIVE bolgan propertylarni korishi mumkun holos
		const match: T = { propertyStatus: PropertyStatus.ACTIVE };
		// sort agar kiritilmasa, default quyidagi mantiqlar ila izlaydi
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		// OOP da hamma narsa abstraction va objectlar reference ga ega.
		this.shapeMatchQuery(match, input);
		console.log('match:', match);

		const result = await this.propertyModel
			.aggregate([
				// yuqorida hosil qilingan match va sort
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						// list nomi bn quyidagilarni search qilib berishi
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },

							// meliked
							lookupAuthMemberLiked(memberId),
							lookupMember, // [] arrayni ichida keladi
							{ $unwind: '$memberData' }, //{$unwind: } arrayni ichidan memberdatani chiqarb beradi
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	private shapeMatchQuery(match: T, input: PropertiesInquiry): void {
		// quyidagi destructiondagi qiymatlar inputdan qabul qilinayotgan qiymatlardur
		const {
			memberId,
			locationList,
			roomsList,
			bedsList,
			typeList,
			periodsRange,
			pricesRange,
			squaresRange,
			options,
			text,
		} = input.search;

		// ayni bir agentni propertysini olish kere bolsa
		if (memberId) match.memberId = shapeIntoMongoObjectId(memberId);
		// inputda kiritilgan hududlarni tanlab beradi
		if (locationList) match.propertyLocation = { $in: locationList };
		// inputda kiritilgan roomlar xonasi
		if (roomsList) match.propertyRooms = { $in: roomsList };
		if (bedsList) match.propertyBeds = { $in: bedsList };
		if (typeList) match.propertyType = { $in: typeList };

		// $gte -> starting price dan katta yoki teng
		// $lte -> ending price dan kichkina yoki teng
		if (pricesRange) match.propertyPrice = { $gte: pricesRange.start, $lte: pricesRange.end };
		if (periodsRange) match.createdAt = { $gte: periodsRange.start, $lte: periodsRange.end };
		if (squaresRange) match.propertySquare = { $gte: squaresRange.start, $lte: squaresRange.end };

		// regular expression orqali searching mehanizmni develop qilyapmiz
		if (text) match.propertyTitle = { $regex: new RegExp(text, 'i') };
		if (options) {
			// ili ili yoki yoki qiymatlardan biri togri kelsa at least
			match['$or'] = options.map((ele) => {
				return { [ele]: true };
			});
		}
	}

	public async getFavorites(memberId: ObjectId, input: OrdinaryInquiry): Promise<Properties> {
		return await this.likeService.getFavoriteProperites(memberId, input);
	}

	public async getVisited(memberId: ObjectId, input: OrdinaryInquiry): Promise<Properties> {
		return await this.viewService.getVisitedProperties(memberId, input);
	}

	public async getAgentProperties(memberId: ObjectId, input: AgentPropertiesInquiry): Promise<Properties> {
		const { propertyStatus } = input.search;
		if (propertyStatus === PropertyStatus.DELETE) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		const match: T = {
			memberId: memberId,
			propertyStatus: propertyStatus ?? { $ne: PropertyStatus.DELETE },
		};

		const sort: T = {
			[input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC,
		};

		const result = await this.propertyModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupMember,
							{ $unwind: '$memberData' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async likeTargetProperty(memberId: ObjectId, likeRefId: ObjectId): Promise<Property> {
		const target: Property = await this.propertyModel
			.findOne({ _id: likeRefId, propertyStatus: PropertyStatus.ACTIVE })
			.exec();

		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.PROPERTY,
		};

		// Like Toggle va Like modules
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.propertyStatsEditor({ _id: likeRefId, targetKey: 'propertyLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETING_WENT_WRONG);
		return result;
	}

	public async getAllPropertiesByAdmin(input: AllProperitesInquiry): Promise<Properties> {
		const { propertyStatus, propertyLocationList } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (propertyStatus) match.propertyStatus = propertyStatus;
		if (propertyLocationList) match.propertyLocation = { $in: propertyLocationList };

		const result = await this.propertyModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit }, // [property1] [property2]
							lookupMember, //['$memberData']
							{ $unwind: '$memberData' }, // memberData ni arraydan chiqarib memberDataga tenglab beradi
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		//console.log('lookupMember:', lookupMember);
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async updatePropertyByAdmin(input: PropertyUpdate): Promise<Property> {
		// deconstruction
		let { propertyStatus, soldAt, deletedAt } = input;

		const search: T = {
			_id: input._id,
			propertyStatus: PropertyStatus.ACTIVE,
		};

		if (propertyStatus === PropertyStatus.SOLD) soldAt = moment().toDate();
		else if (propertyStatus === PropertyStatus.DELETE) deletedAt = moment().toDate();

		const result = await this.propertyModel.findOneAndUpdate(search, input, { new: true }).exec();

		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		if (soldAt || deletedAt) {
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberProperties',
				modifier: -1,
			});
		}
		return result;
	}

	public async removePropertyByAdmin(propertyId: ObjectId): Promise<Property> {
		const search: T = { _id: propertyId, propertyStatus: PropertyStatus.DELETE };
		const result = await this.propertyModel.findOneAndDelete(search).exec();

		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);

		return result;
	}

	public async propertyStatsEditor(input: StatisticModifier): Promise<Property> {
		const { _id, targetKey, modifier } = input;

		return await this.propertyModel
			.findByIdAndUpdate(
				_id,
				{ $inc: { [targetKey]: modifier } },
				{
					new: true,
				},
			)
			.exec();
	}
}
