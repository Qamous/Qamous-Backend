import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { Country } from '../../../typeorm/entities/country';
import { CreateCountryParams, UpdateCountryParams } from '../../../utils/types';

@Injectable()
export class CountriesService {
  constructor(
    @InjectRepository(Country)
    private countriesRepository: Repository<Country>,
  ) {}

  /*
   * This returns all countries
   *
   * @returns {Promise<Country[]>} - an array of all Country objects
   */
  async getAllCountries(): Promise<Country[]> {
    return this.countriesRepository.find();
  }

  /*
   * This returns a country by its code
   *
   * @param {string} countryCode - the code of the country to return
   * @returns {Promise<Country>} - the Country object with the specified code
   */
  async getCountryByCode(countryCode: string): Promise<Country> {
    return this.countriesRepository.findOne({ where: { countryCode } });
  }

  /*
   * This creates a new country
   *
   * @param {CreateCountryParams} createCountryDto - a CreateCountryParams object that contains the
   * details of the new country
   * @returns {Promise<Country>} - the newly created Country object
   */
  async createCountry(createCountryDto: CreateCountryParams): Promise<Country> {
    const newCountry = this.countriesRepository.create(createCountryDto);
    await this.countriesRepository.save(newCountry);
    return newCountry;
  }

  /*
   * This updates a country by its code
   *
   * @param {string} countryCode - the code of the country to update
   * @param {UpdateCountryParams} updateCountryDto - an UpdateCountryParams object that contains the
   * details of the country to replace the existing country
   * @returns {Promise<UpdateResult>} - the update result
   */
  async updateCountry(
    countryCode: string,
    updateCountryDto: UpdateCountryParams,
  ): Promise<UpdateResult> {
    const result = await this.countriesRepository.update(
      { countryCode },
      updateCountryDto,
    );

    if (result.affected === 0) {
      throw new HttpException('Country not found', 404);
    }

    return result;
  }

  /*
   * This deletes a country by its code
   *
   * @param {string} countryCode - the code of the country to delete
   * @returns {Promise<UpdateResult>} - the delete result
   */
  deleteCountry(countryCode: string) {
    return this.countriesRepository.delete({ countryCode });
  }
}
