/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Member, Members } from '../../libs/dto/member/member';
import { AgentsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { AuthService } from '../auth/auth.service';
import { MemberUpdate } from '../../libs/dto/member/member.update';
import { StatisticModifier, T } from '../../libs/types/common';
import { ViewService } from '../view/view.service';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ViewGroup } from '../../libs/enums/view.enum';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeService } from '../like/like.service';

import { lookupAuthMemberLiked } from '../../libs/config';
import { Follower, Following, MeFollowed } from '../../libs/follow/follow';

@Injectable()
export class MemberService {
	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Follow') private readonly followModel: Model<Follower | Following>,

		//Dependency Injection orqali Instance hosil qilyabmiz
		private authService: AuthService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	public async signup(input: MemberInput): Promise<Member> {
		/* Hashing the Password */
		input.memberPassword = await this.authService.hashPassword(input.memberPassword);

		// try=catch()= ishlatishimizdan sabab mongo db ni errorini ozimizni error standardizmizga otkazsh uchun
		try {
			const result = await this.memberModel.create(input);

			/*  Authentication via TOKEN  */
			result.accessToken = await this.authService.createToken(result);

			return result;
		} catch (err) {
			console.log('Error, Service.model:', err.message);
			throw new BadRequestException(Message.USED_MEMBER_NICK_OR_PHONE);
		}
	}

	public async login(input: LoginInput): Promise<Member> {
		const { memberNick, memberPassword } = input;

		//console.log('input:', input);
		//it will printout incoming input value(req.body part)

		const response: Member = await this.memberModel
			.findOne({ memberNick: memberNick })
			.select('+memberPassword')
			.exec();

		if (!response || response.memberStatus === MemberStatus.DELETE) {
			throw new InternalServerErrorException(Message.NO_MEMBER_NICK);
		} else if (response.memberStatus === MemberStatus.BLOCK) {
			throw new InternalServerErrorException(Message.BLOCKED_USER);
		}

		/* Password Comparison */

		const isMatch = await this.authService.comparePasswords(input.memberPassword, response.memberPassword);
		if (!isMatch) throw new InternalServerErrorException(Message.WRONG_PASSWORD);

		response.accessToken = await this.authService.createToken(response);

		return response;
	}

	public async updateMember(memberId: ObjectId, input: MemberUpdate): Promise<Member> {
		// console.log('inputId:', input);
		// console.log('memberID:', memberId);

		//Faqat active memberlar uzini malumotini ozgartirishi uchun permission

		const result: Member = await this.memberModel
			.findOneAndUpdate(
				{
					_id: memberId,
					memberStatus: MemberStatus.ACTIVE,
				},
				input,
				{ new: true },
			)
			.exec();
		console.log('result:', result);
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		/* Ohirgi ozgargan malumotlar asosida 
		token ni qayta qurib olamiz bunga sabab 
		frontend da biz accessToken ni ichidagi malumotlardan foydalanamiz.
		*/
		result.accessToken = await this.authService.createToken(result);
		return result;
	}

	public async getMember(memberId: ObjectId, targetId: ObjectId): Promise<Member> {
		// Faqat Active yoki Block bolgan userlarnigina malumotlarini kora olish imkoniyatini taqdim ettik
		const search: T = {
			_id: targetId,
			memberStatus: {
				$in: [MemberStatus.ACTIVE, MemberStatus.BLOCK],
			},
		};

		// search = POSTMAN da input da kiritilgan memberID
		//console.log('search:=>', search); // -> later to comment

		const targetMember = await this.memberModel.findOne(search).lean().exec();

		// targetMember = POSTMANda kiritilgan memberId orqali topilgan USER ning malumotlari
		//console.log('targetMember:', targetMember); // -> later to comment

		if (!targetId) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (memberId) {
			// record view
			const viewInput: ViewInput = {
				memberId: memberId,
				viewRefId: targetId,
				viewGroup: ViewGroup.MEMBER,
			};
			const newView = await this.viewService.recordView(viewInput);

			//console.log('newView:', newView); // -> later to comment

			// memberView increment
			if (newView) {
				// $inc: = increment
				await this.memberModel.findOneAndUpdate(search, { $inc: { memberViews: 1 } }, { new: true }).exec();

				// Clientside ga yangilgan memberViews ni sonini yuboradi agar bomasa ozgarish faqatgina DB da sodir boladi
				targetMember.memberViews++;
			}

			// meLiked
			const likeInput = { memberId: memberId, likeRefId: targetId, likeGroup: LikeGroup.MEMBER };
			targetMember.meLiked = await this.likeService.checkLikeExistence(likeInput);

			//meFollowed
			targetMember.meFollowed = await this.checkSubscription(memberId, targetId);
		}

		return targetMember;
	}

	private async checkSubscription(followerId: ObjectId, followingId: ObjectId): Promise<MeFollowed[]> {
		const result = await this.followModel
			.findOne({
				followerId: followerId,
				followingId: followingId,
			})
			.exec();

		return result ? [{ followerId: followerId, followingId: followingId, myFollowing: true }] : [];
	}

	public async getAgents(memberId: ObjectId, input: AgentsInquiry): Promise<Members> {
		const { text } = input.search;

		//console.log('text:::', text);

		const match: T = {
			memberType: MemberType.AGENT,
			memberStatus: MemberStatus.ACTIVE,
		};

		//console.log('match:::', match); //-> to later comment

		const sort: T = {
			[input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC,
		};
		//bu ->
		// -> shu mantiq bn bir xil korinish bn boladi
		// const sort: T = { createdAt: -1 };

		//console.log('sort:::', sort); //-> to later comment

		if (text) match.memberNick = { $regex: new RegExp(text, 'i') };

		//console.log('match:::', match); //-> to later comment

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, lookupAuthMemberLiked(memberId)],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		console.log('result:', result); //-> to later comment

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async likeTargetMember(memberId: ObjectId, likeRefId: ObjectId): Promise<Member> {
		const target: Member = await this.memberModel.findOne({ _id: likeRefId, memberStatus: MemberStatus.ACTIVE }).exec();

		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.MEMBER,
		};

		// Like Toggle va Like modules
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.memberStatsEditor({ _id: likeRefId, targetKey: 'memberLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETING_WENT_WRONG);
		return result;
	}

	public async getAllMembersByAdmin(input: MembersInquiry): Promise<Members> {
		// searching mehanizmi
		const { memberStatus, memberType, text } = input.search;
		const match: T = {};
		const sort: T = {
			[input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC,
		}; //bu ->
		// -> shu mantiq bn bir xil korinish bn boladi
		// const sort: T = { createdAt: -1 };

		if (memberStatus) match.memberStatus = memberStatus;

		// console.log('match:', match);

		if (memberType) match.memberType = memberType;

		if (text) match.memberNick = { $regex: new RegExp(text, 'i') };
		console.log('match:', match);

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }], //-> pipeline
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		//console.log('result:', result);
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async updateMemberByAdmin(input: MemberUpdate): Promise<Member> {
		const result: Member = await this.memberModel.findOneAndUpdate({ _id: input._id }, input, { new: true }).exec();

		console.log('input:', input);
		console.log('input_id:', input._id);

		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	public async memberStatsEditor(input: StatisticModifier): Promise<Member> {
		console.log('executed');
		const { _id, targetKey, modifier } = input;

		return await this.memberModel.findByIdAndUpdate(_id, { $inc: { [targetKey]: modifier } }, { new: true }).exec();
	}
}
