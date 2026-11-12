"""Extract in-game map marker icons (2.x mappin atlas, BC7) to web/mapicons/<Variant>.png.

Usage: python -I extract_mapicons.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_bc7 import part_image  # noqa: E402

# Variant name (without "Variant"/"Zzz##_") -> part in base\gameplay\gui\common\icons\mappin_icons
GIG = 'gigs'   # In game version 2.x, all gigs use the same boxed "!" icon.
MAP = {
    'DefaultQuest': 'quest', 'DynamicEvent': 'dynamic_event', 'Conversation': 'talk',
    'PhoneCall': 'call', 'BountyHunt': GIG, 'Retrieving': GIG, 'Thievery': GIG, 'Sabotage': GIG,
    'ClientInDistress': GIG, 'SOSsignal': GIG, 'Courier': GIG, 'CourierSandboxActivity': 'courier',  # steering wheel (El Capitan contracts)
    'Convoy': GIG, 'QuestGiver': 'quest_giver', 'ExclamationMark': 'quest_excmark',
    'Fixer': 'fixer', 'NCPDGig': 'map_bounty', 'GangWatch': 'gang_watch',
    'Outpost': 'outpost', 'HiddenStash': 'hidden_stash', 'HuntForPsycho': 'hunt_for_psycho',
    'QuestionMark': 'undiscovered', 'Tarot': 'tarot_card', 'Racing': 'racing',
    'WorldEncounter': 'world_activities', 'RoadBlockade': 'roadblock',
    'RelicDeviceBasic': 'relic_access_point', 'RelicDeviceSpecial': 'relic_access_point',
    'ServicePointDropPoint': 'dropbox', 'ServicePointClothes': 'clothes',
    'ServicePointRipperdoc': 'ripperdoc', 'ServicePointCyberware': 'ripperdoc',
    'ServicePointNetTrainer': 'netservice', 'ServicePointGuns': 'gun',
    'ServicePointMeleeTrainer': 'melee', 'ServicePointMeds': 'medicine',
    'ServicePointFood': 'food_vendor', 'ServicePointBar': 'bar',
    'ServicePointProstitute': 'prostitute', 'ServicePointJunk': 'junk_shop',
    'ServicePointTech': 'tech', 'ServicePointBlackMarket': 'black_market_vendor',
    'ServicePointGlamdoc': 'glamdoc', 'WanderingMerchant': 'wandering_merchant',
    'CarForPurchase': 'car_to_buy', 'MotorcycleForPurchase': 'motorcycle_to_buy',
    'FastTravel': 'fast_travel', 'NCART': 'fast_travel_metro', 'DelamainTaxi': 'delamain',
    'Apartment': 'apartment', 'ApartmentToPurchase': 'apartment_to_buy',
    'PlayerStash': 'V_owned', 'Wardrobe': 'ico_wardrobe',
}


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'mapicons')
    os.makedirs(out_dir, exist_ok=True)
    ok = 0
    for variant, part in MAP.items():
        try:
            im = part_image(part)
        except KeyError:
            print('missing', variant, part)
            continue
        im = im.crop(im.getbbox() or (0, 0, im.width, im.height))
        im.thumbnail((128, 128))
        im.save(os.path.join(out_dir, variant + '.png'))
        ok += 1
    print(f'{ok}/{len(MAP)} icons in {os.path.normpath(out_dir)}')


if __name__ == '__main__':
    main()
