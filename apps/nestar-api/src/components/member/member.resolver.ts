/* eslint-disable @typescript-eslint/no-unused-vars */
import { Mutation, Resolver, Query, Args } from '@nestjs/graphql';
import { MemberService } from './member.service';
import { AgentsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { Member, Members } from '../../libs/dto/member/member';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Model, ObjectId } from 'mongoose';
import { MemberType } from '../../libs/enums/member.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberUpdate } from '../../libs/dto/member/member.update';
import { getSerialForImage, shapeIntoMongoObjectId, validMimeTypes } from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import { GraphQLUpload, FileUpload } from 'graphql-upload';
import { Mode, createWriteStream } from 'fs';
import { Message } from '../../libs/enums/common.enum';

@Resolver()
// @UsePipes(ValidationPipe)=> Resolver darajasida pipe validation ni ishlatish
export class MemberResolver {
	constructor(private readonly memberService: MemberService) {}

	@Mutation(() => Member)
	// @UsePipes(ValidationPipe)=>method miqyosida validation ni amalga oshirish
	public async signup(@Args('input') input: MemberInput): Promise<Member> {
		console.log('Mutation:, signup');

		return await this.memberService.signup(input);
	}

	@Mutation(() => Member)
	public async login(@Args('input') input: LoginInput): Promise<Member> {
		console.log('Mutation:, login');

		return await this.memberService.login(input);
	}

	/**  For Testing Purposes only  **/
	@UseGuards(AuthGuard)
	@Query(() => String)
	public async checkAuth(@AuthMember('memberNick') memberNick: string): Promise<string> {
		console.log('Query: checkAuth');
		console.log('memberNick:', memberNick);
		return `Hi ${memberNick}`;
	}

	/** For testing purposes only **/
	// allowing for two kinds of users!
	@Roles(MemberType.USER, MemberType.AGENT)
	@UseGuards(RolesGuard)
	@Query(() => String)
	// @AuthMember => customized decorator yani ozimiz yasab oldik.
	public async checkAuthRoles(@AuthMember('') authMember: Member): Promise<string> {
		console.log('Mutation:, checkAuthRoles');
		console.log('memberNick:=>', authMember);
		return `Hi ${authMember.memberNick}, you are ${authMember.memberType} ('memberId: ${authMember._id})`;
	}

	/* Authentication */
	//Authenticated ( USER , AGENT, ADMIN )
	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	// authMemberni xoxlagan nom bn atash mumkin   authMember=data=memberNick
	// memberimini umumiy malumoti kerak bolsa @AuthMember()ni ichiga xechnimani qoymeymiz
	public async updateMember(
		@Args('input') input: MemberUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		console.log('Mutation: updateMember');

		/** Client dan inputda kirib kelgan id ni Delete qilib oldik **/
		delete input._id;

		return await this.memberService.updateMember(memberId, input);
	}

	/** WithoutGuard () yordamida har qanday User yani authenticated bolgan yoki bolmagan
	 holatida bu getMember() apidan foydalanishi mumkun. agar auth busa memberId ni korsatib beradi
	 aks holda memberId = null ga teng boladi **/
	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public async getMember(@Args('memberId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Member> {
		/** memberId => aynan qaysi memberni malumotini olmoqchi bolsak **/

		console.log('Query:, getMember');

		// console.log('memberId:', memberId);

		const targetId = shapeIntoMongoObjectId(input);
		return await this.memberService.getMember(memberId, targetId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Members)
	public async getAgents(@Args('input') input: AgentsInquiry, @AuthMember('_id') memberId: ObjectId): Promise<Members> {
		console.log('Query: getAgents');

		return await this.memberService.getAgents(memberId, input);
	}

	/**  LIKE  **/

	@UseGuards(AuthGuard)
	@Mutation((returns) => Member)
	public async likeTargetMember(
		// memberId => qaysi memberga
		@Args('memberId') input: string,
		// kim like bosayotkanligi
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		console.log('Mutation: likeTargetMember');

		const likeRefId = shapeIntoMongoObjectId(input);

		return await this.memberService.likeTargetMember(memberId, likeRefId);
	}

	/**  ADMIN  **/

	// Authorization: ADMIN
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public async getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		console.log('Query: getAllMembersByAdmin');
		return await this.memberService.getAllMembersByAdmin(input);
	}

	// Authorization: ADMIN
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async updateMemberByAdmin(@Args('input') input: MemberUpdate): Promise<Member> {
		console.log('Mutation: updateMemberByAdmin');
		return await this.memberService.updateMemberByAdmin(input);
	}

	/**  IMAGE UPLOADER **/
	@UseGuards(AuthGuard)
	@Mutation((returns) => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload })
		{ createReadStream, filename, mimetype }: FileUpload,
		@Args('target') target: string,
	): Promise<string> {
		console.log('Mutation: imageUploader');

		if (!filename) throw new Error(Message.UPLOAD_FAILED);
		const validMime = validMimeTypes.includes(mimetype);

		//-> checking mimeType
		console.log('mimeType:', mimetype);

		if (!validMime) throw new Error(Message.PROVIDE_ALLOWED_FORMAT);

		const imageName = getSerialForImage(filename);
		const url = `uploads/${target}/${imageName}`;
		const stream = createReadStream();

		const result = await new Promise((resolve, reject) => {
			stream
				.pipe(createWriteStream(url))
				.on('finish', async () => resolve(true))
				.on('error', () => reject(false));
		});
		if (!result) throw new Error(Message.UPLOAD_FAILED);

		return url;
	}

	/**  IMAGES UPLOADER **/
	@UseGuards(AuthGuard)
	@Mutation((returns) => [String])
	public async imagesUploader(
		@Args('files', { type: () => [GraphQLUpload] })
		files: Promise<FileUpload>[],
		@Args('target') target: string, //-> (String)to change later
	): Promise<string[]> {
		console.log('Mutation: imagesUploader');

		const uploadedImages = [];
		const promisedList = files.map(async (img: Promise<FileUpload>, index: number): Promise<Promise<void>> => {
			try {
				const { filename, mimetype, encoding, createReadStream } = await img;

				const validMime = validMimeTypes.includes(mimetype);

				//TODO: SECURITY DEVELOP

				if (!validMime) throw new Error(Message.PROVIDE_ALLOWED_FORMAT);

				const imageName = getSerialForImage(filename);
				const url = `uploads/${target}/${imageName}`;
				const stream = createReadStream();

				const result = await new Promise((resolve, reject) => {
					stream
						.pipe(createWriteStream(url))
						.on('finish', () => resolve(true))
						.on('error', () => reject(false));
				});
				if (!result) throw new Error(Message.UPLOAD_FAILED);

				uploadedImages[index] = url;
			} catch (err) {
				console.log('Error, file missing!');
			}
		});

		await Promise.all(promisedList);
		return uploadedImages;
	}
}
